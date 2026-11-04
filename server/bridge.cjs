// VibeCode Host Bridge - cong 9334 (relay CDP 9333).
// Yeu cau Node >= 22 (WebSocket tich hop).
//
// Kien truc hieu nang cao (tham khao nightscout/cgm-remote-monitor):
//   1. Persistent CDP WebSocket Pool: tai su dung ket noi WS toi cong 9333 thay vi mo/dong moi lenh.
//   2. Gzip HTTP Compression & Static ETag (304 Not Modified): giam ~70% bang thong qua LAN/Tunnel.
//   3. Delta Hash & System Telemetry (/health, /status): theo doi RTT delta, uptime, bo nho, va do tuoi du lieu.
//
// Bien moi truong:
//   VIBE_PIN   : PIN bat buoc (>= 6 ky tu). Neu bo trong se sinh PIN ngau nhien va in ra.
//   VIBE_BIND  : dia chi lang nghe, mac dinh 127.0.0.1. Dat 0.0.0.0 de cho phep truy cap LAN.
//   VIBE_ROOT  : thu muc goc duoc phep duyet/ghi, mac dinh thu muc home.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');

const BRIDGE_PORT = 9334;
const CDP_PORT = 9333;
const BIND = process.env.VIBE_BIND || '127.0.0.1';
const ROOT = path.resolve(process.env.VIBE_ROOT || os.homedir());
const WEAK_PINS = new Set(['123456', '000000', '111111', '654321', '12345678']);
const MAX_BODY = 1024 * 1024;
const ALLOWED_ARTIFACTS = new Set(['CLAUDE.md', 'AGENTS.md', '.vibe-session-handoff.json']);
const STARTED_AT = Date.now();

let PIN = process.env.VIBE_PIN || '';
let generated = false;
if (!PIN) {
  PIN = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  generated = true;
}
if (PIN.length < 6 || WEAK_PINS.has(PIN)) {
  console.error('[LOI] VIBE_PIN qua yeu (can >= 6 ky tu, khong dung PIN pho bien).');
  process.exit(1);
}

// ---------- Thong ke he thong (System Telemetry) ----------
const cdpStats = {
  totalCalls: 0,
  errors: 0,
  lastRttMs: null,
  prevRttMs: null,
  rttDeltaMs: 0,
  avgRttMs: 0,
  lastActivityAt: null
};

function recordCdpSample(rttMs, isError = false) {
  cdpStats.totalCalls += 1;
  cdpStats.lastActivityAt = Date.now();
  if (isError) {
    cdpStats.errors += 1;
    return;
  }
  cdpStats.prevRttMs = cdpStats.lastRttMs;
  cdpStats.lastRttMs = rttMs;
  cdpStats.rttDeltaMs = cdpStats.prevRttMs !== null ? rttMs - cdpStats.prevRttMs : 0;
  cdpStats.avgRttMs =
    cdpStats.avgRttMs === 0 ? rttMs : Math.round(cdpStats.avgRttMs * 0.8 + rttMs * 0.2);
}

// ---------- Tien ich ----------
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isInsideRoot(target) {
  const rel = path.relative(ROOT, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveInRoot(p) {
  const resolved = path.resolve(p || ROOT);
  if (!isInsideRoot(resolved)) throw new Error('Duong dan nam ngoai thu muc goc cho phep: ' + ROOT);
  return resolved;
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function getGitStatus(dirPath) {
  try {
    const opts = { cwd: dirPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).trim();
    const st = execFileSync('git', ['status', '--short'], opts).trim();
    return { isGit: true, branch, changes: st ? st.split('\n').filter(Boolean) : [] };
  } catch {
    return { isGit: false, branch: null, changes: [] };
  }
}

function acceptsGzip(req) {
  const enc = req && req.headers ? String(req.headers['accept-encoding'] || '') : '';
  return enc.includes('gzip');
}

function sendJson(res, code, obj, req = null) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  if (req && acceptsGzip(req) && raw.length > 1024) {
    const gz = zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_SPEED });
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding'
    });
    res.end(gz);
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body qua lon'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- Chong do PIN ----------
const failures = new Map(); // ip -> { count, until }
function isLocked(ip) {
  const f = failures.get(ip);
  return !!f && f.until > Date.now();
}
function registerFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) {
    f.until = Date.now() + 5 * 60 * 1000;
    f.count = 0;
  }
  failures.set(ip, f);
}

// ---------- Persistent CDP WebSocket Pool & Hang doi tuan tu ----------
const cdpQueues = new Map(); // targetKey -> Promise
const cdpPool = new Map();   // localWsUrl -> { ws, nextId, pending, idleTimer, openPromise }
const POOL_IDLE_MS = 60 * 1000;

function enqueueCdp(targetKey, task) {
  const prev = cdpQueues.get(targetKey) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  cdpQueues.set(targetKey, next);
  next.finally(() => {
    if (cdpQueues.get(targetKey) === next) cdpQueues.delete(targetKey);
  }).catch(() => {});
  return next;
}

function buildLocalWsUrl(wsUrl) {
  const u = new URL(String(wsUrl));
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error('wsUrl khong hop le');
  if (!u.pathname.startsWith('/devtools/')) throw new Error('wsUrl khong phai duong dan DevTools');
  return { url: 'ws://127.0.0.1:' + CDP_PORT + u.pathname, key: u.pathname };
}

function dropPoolEntry(localWsUrl, reasonErr) {
  const entry = cdpPool.get(localWsUrl);
  if (!entry) return;
  cdpPool.delete(localWsUrl);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  for (const [, p] of entry.pending) {
    clearTimeout(p.timer);
    p.reject(reasonErr || new Error('CDP WebSocket dong'));
  }
  entry.pending.clear();
  try { entry.ws.close(); } catch {}
}

function touchPoolIdle(localWsUrl, entry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (entry.pending.size === 0) dropPoolEntry(localWsUrl);
  }, POOL_IDLE_MS);
  if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
}

function getPooledCdpEntry(localWsUrl) {
  const existing = cdpPool.get(localWsUrl);
  if (existing && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
    touchPoolIdle(localWsUrl, existing);
    return existing;
  }
  dropPoolEntry(localWsUrl);

  const ws = new WebSocket(localWsUrl);
  const entry = {
    ws,
    nextId: 1,
    pending: new Map(),
    idleTimer: null,
    openPromise: null
  };

  entry.openPromise = new Promise((resolve, reject) => {
    const connTimer = setTimeout(() => {
      dropPoolEntry(localWsUrl, new Error('CDP Connect Timeout'));
      reject(new Error('CDP Connect Timeout'));
    }, 4500);

    ws.onopen = () => {
      clearTimeout(connTimer);
      resolve(entry);
    };
    ws.onerror = () => {
      clearTimeout(connTimer);
      const err = new Error('Khong noi duoc WebSocket ' + CDP_PORT);
      dropPoolEntry(localWsUrl, err);
      reject(err);
    };
  });

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && entry.pending.has(msg.id)) {
        const reqItem = entry.pending.get(msg.id);
        entry.pending.delete(msg.id);
        clearTimeout(reqItem.timer);
        if (msg.error) reqItem.reject(new Error(msg.error.message || 'CDP Error'));
        else reqItem.resolve(msg.result);
      }
    } catch {}
  };

  ws.onclose = () => {
    dropPoolEntry(localWsUrl, new Error('CDP WebSocket da dong'));
  };

  touchPoolIdle(localWsUrl, entry);
  cdpPool.set(localWsUrl, entry);
  return entry;
}

async function runCdp(localWsUrl, method, params) {
  const entry = getPooledCdpEntry(localWsUrl);
  await entry.openPromise;
  touchPoolIdle(localWsUrl, entry);

  return new Promise((resolve, reject) => {
    const id = entry.nextId++;
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error('CDP Relay Timeout'));
    }, 6500);

    entry.pending.set(id, { resolve, reject, timer });
    try {
      entry.ws.send(JSON.stringify({ id, method, params: params || {} }));
    } catch (err) {
      clearTimeout(timer);
      entry.pending.delete(id);
      dropPoolEntry(localWsUrl, err);
      reject(err);
    }
  });
}

// ---------- Giao dien tinh (dist) voi ETag & Gzip ----------
const DIST = path.resolve(__dirname, '..', 'dist');
const API_PATHS = new Set(['/health', '/status', '/json', '/cdp', '/fs', '/open', '/context-artifact']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest']);

function tryServeStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch { return false; }
  if (API_PATHS.has(pathname)) return false;
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return false;

  let file = path.resolve(DIST, '.' + (pathname === '/' ? '/index.html' : pathname));
  const rel = path.relative(DIST, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return true; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html');

  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
  const isImmutableAsset = pathname.startsWith('/assets/');

  if (req.headers && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'ETag': etag });
    res.end();
    return true;
  }

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isImmutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'ETag': etag
  };

  if (COMPRESSIBLE_EXT.has(ext) && acceptsGzip(req) && stat.size > 1024) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })).pipe(res);
    return true;
  }

  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

function buildSystemStatus() {
  const mem = process.memoryUsage();
  return {
    ok: true,
    host: os.hostname(),
    platform: os.platform(),
    lanIp: getLocalIp(),
    home: ROOT,
    cdpPort: CDP_PORT,
    uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
    memoryMb: Math.round(mem.rss / 1048576),
    pooledSockets: cdpPool.size,
    cdpStats
  };
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vibe-Pin, If-None-Match');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Phuc vu giao dien da build (dist/) de mo qua Tunnel/LAN bang cung mot link.
  // Chi la file tinh cong khai; moi API van yeu cau PIN.
  if (req.method === 'GET' && tryServeStatic(req, res)) return;

  const ip = req.socket.remoteAddress || 'unknown';
  if (isLocked(ip)) return sendJson(res, 429, { error: 'Qua nhieu lan sai PIN. Thu lai sau.' }, req);

  const clientPin = req.headers['x-vibe-pin'];
  const authed = typeof clientPin === 'string' && safeEqual(clientPin, PIN);
  const urlObj = new URL(req.url, 'http://localhost:' + BRIDGE_PORT);

  // /health & /status: khong can PIN chi tra {ok:true}; dung PIN tra day du telemetry.
  if (urlObj.pathname === '/health' || urlObj.pathname === '/status') {
    if (!authed) return sendJson(res, 200, { ok: true }, req);
    return sendJson(res, 200, buildSystemStatus(), req);
  }

  if (!authed) {
    registerFailure(ip);
    return sendJson(res, 401, { error: 'Thieu hoac sai ma PIN bao mat (X-Vibe-Pin)' }, req);
  }

  try {
    if (urlObj.pathname === '/json') {
      http.get('http://127.0.0.1:' + CDP_PORT + '/json/list', (cdpRes) => {
        let raw = '';
        cdpRes.on('data', (c) => (raw += c));
        cdpRes.on('end', () => {
          try {
            sendJson(res, 200, JSON.parse(raw), req);
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(raw);
          }
        });
      }).on('error', (err) => {
        sendJson(res, 502, { error: 'CDP Port ' + CDP_PORT + ' chua phan hoi: ' + err.message }, req);
      });
      return;
    }

    if (urlObj.pathname === '/cdp' && req.method === 'POST') {
      const { wsUrl, method, params, prevHash } = JSON.parse(await readBody(req));
      if (typeof method !== 'string' || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) {
        return sendJson(res, 400, { ok: false, error: 'method CDP khong hop le' }, req);
      }
      const { url, key } = buildLocalWsUrl(wsUrl);
      const started = Date.now();
      try {
        const result = await enqueueCdp(key, () => runCdp(url, method, params));
        const rttMs = Date.now() - started;
        recordCdpSample(rttMs, false);

        const serialized = JSON.stringify(result ?? null);
        const hash = crypto.createHash('sha1').update(serialized).digest('hex').slice(0, 16);
        if (prevHash && prevHash === hash) {
          return sendJson(res, 200, {
            ok: true,
            unchanged: true,
            hash,
            rttMs,
            rttDeltaMs: cdpStats.rttDeltaMs
          }, req);
        }

        return sendJson(res, 200, {
          ok: true,
          unchanged: false,
          hash,
          rttMs,
          rttDeltaMs: cdpStats.rttDeltaMs,
          result
        }, req);
      } catch (e) {
        recordCdpSample(Date.now() - started, true);
        return sendJson(res, 500, { ok: false, error: e.message }, req);
      }
    }

    if (urlObj.pathname === '/fs' && req.method === 'GET') {
      const targetDir = resolveInRoot(urlObj.searchParams.get('path'));
      const items = fs.readdirSync(targetDir, { withFileTypes: true });
      const folders = items
        .filter((i) => i.isDirectory() && !i.name.startsWith('.'))
        .slice(0, 50)
        .map((i) => ({ name: i.name, path: path.join(targetDir, i.name) }));
      const handoffPath = path.join(targetDir, '.vibe-session-handoff.json');
      let handoffData = null;
      try {
        handoffData = fs.existsSync(handoffPath) ? JSON.parse(fs.readFileSync(handoffPath, 'utf8')) : null;
      } catch {}
      const parent = path.dirname(targetDir);
      return sendJson(res, 200, {
        currentPath: targetDir,
        parentPath: isInsideRoot(parent) ? parent : targetDir,
        folders,
        contextMeta: {
          hasClaude: fs.existsSync(path.join(targetDir, 'CLAUDE.md')),
          hasAgents: fs.existsSync(path.join(targetDir, 'AGENTS.md')),
          handoffData,
          git: getGitStatus(targetDir)
        }
      }, req);
    }

    if (urlObj.pathname === '/open' && req.method === 'POST') {
      const { folderPath } = JSON.parse(await readBody(req));
      const safeDir = resolveInRoot(folderPath);
      if (!fs.statSync(safeDir).isDirectory()) throw new Error('Khong phai thu muc');
      const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
      const codeBin = fs.existsSync(local) ? local : 'code';
      const ch = spawn(codeBin, [safeDir], { detached: true, stdio: 'ignore', shell: codeBin === 'code' });
      ch.unref();
      return sendJson(res, 200, { opened: safeDir }, req);
    }

    if (urlObj.pathname === '/context-artifact' && req.method === 'POST') {
      const { dirPath, fileName, content } = JSON.parse(await readBody(req));
      if (!ALLOWED_ARTIFACTS.has(fileName)) throw new Error('Ten tep khong duoc phep: ' + fileName);
      const dir = resolveInRoot(dirPath);
      const safeFile = path.join(dir, fileName);
      fs.writeFileSync(safeFile, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
      return sendJson(res, 200, { saved: safeFile }, req);
    }

    res.writeHead(404);
    res.end();
  } catch (e) {
    sendJson(res, 400, { error: e.message }, req);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[LOI] Cong ' + BRIDGE_PORT + ' dang duoc su dung (bridge khac dang chay?). Thoat.');
  } else {
    console.error('[LOI] ' + err.message);
  }
  process.exit(1);
});

server.listen(BRIDGE_PORT, BIND, () => {
  console.log('>>> [HOST BRIDGE READY]');
  console.log('-> Lang nghe: ' + BIND + ':' + BRIDGE_PORT + (BIND === '0.0.0.0' ? ' (cho phep LAN)' : ' (chi may nay)'));
  console.log('-> Thu muc goc: ' + ROOT);
  if (BIND === '0.0.0.0') console.log('-> LAN: http://' + getLocalIp() + ':' + BRIDGE_PORT + '/health');
  if (generated) console.log('-> PIN ngau nhien phien nay: ' + PIN);
  else console.log('-> PIN lay tu VIBE_PIN.');
});
