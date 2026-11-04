// VibeCode Host Bridge - cong 9334 (relay CDP 9333).
// Yeu cau Node >= 22 (WebSocket tich hop).
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
const { spawn, execFileSync } = require('child_process');

const BRIDGE_PORT = 9334;
const CDP_PORT = 9333;
const BIND = process.env.VIBE_BIND || '127.0.0.1';
const ROOT = path.resolve(process.env.VIBE_ROOT || os.homedir());
const WEAK_PINS = new Set(['123456', '000000', '111111', '654321', '12345678']);
const MAX_BODY = 1024 * 1024;
const ALLOWED_ARTIFACTS = new Set(['CLAUDE.md', 'AGENTS.md', '.vibe-session-handoff.json']);

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

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
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

// ---------- Hang doi CDP (tuan tu hoa theo muc tieu) ----------
const cdpQueues = new Map(); // targetId -> Promise
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

function runCdp(localWsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(localWsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('CDP Relay Timeout'));
    }, 6500);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params: params || {} }));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (err) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(err);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Khong noi duoc WebSocket ' + CDP_PORT));
    };
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vibe-Pin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const ip = req.socket.remoteAddress || 'unknown';
  if (isLocked(ip)) return sendJson(res, 429, { error: 'Qua nhieu lan sai PIN. Thu lai sau.' });

  const clientPin = req.headers['x-vibe-pin'];
  const authed = typeof clientPin === 'string' && safeEqual(clientPin, PIN);
  const urlObj = new URL(req.url, 'http://localhost:' + BRIDGE_PORT);

  // /health: khong can PIN nhung chi tra thong tin chi tiet khi dung PIN.
  if (urlObj.pathname === '/health') {
    if (!authed) return sendJson(res, 200, { ok: true });
    return sendJson(res, 200, {
      ok: true,
      host: os.hostname(),
      platform: os.platform(),
      lanIp: getLocalIp(),
      home: ROOT,
      cdpPort: CDP_PORT
    });
  }

  if (!authed) {
    registerFailure(ip);
    return sendJson(res, 401, { error: 'Thieu hoac sai ma PIN bao mat (X-Vibe-Pin)' });
  }

  try {
    if (urlObj.pathname === '/json') {
      http.get('http://127.0.0.1:' + CDP_PORT + '/json/list', (cdpRes) => {
        let raw = '';
        cdpRes.on('data', (c) => (raw += c));
        cdpRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(raw);
        });
      }).on('error', (err) => {
        sendJson(res, 502, { error: 'CDP Port ' + CDP_PORT + ' chua phan hoi: ' + err.message });
      });
      return;
    }

    if (urlObj.pathname === '/cdp' && req.method === 'POST') {
      const { wsUrl, method, params } = JSON.parse(await readBody(req));
      if (typeof method !== 'string' || !/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) {
        return sendJson(res, 400, { ok: false, error: 'method CDP khong hop le' });
      }
      const { url, key } = buildLocalWsUrl(wsUrl);
      const started = Date.now();
      try {
        const result = await enqueueCdp(key, () => runCdp(url, method, params));
        return sendJson(res, 200, { ok: true, rttMs: Date.now() - started, result });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
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
      });
    }

    if (urlObj.pathname === '/open' && req.method === 'POST') {
      const { folderPath } = JSON.parse(await readBody(req));
      const safeDir = resolveInRoot(folderPath);
      if (!fs.statSync(safeDir).isDirectory()) throw new Error('Khong phai thu muc');
      const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe');
      const codeBin = fs.existsSync(local) ? local : 'code';
      const ch = spawn(codeBin, [safeDir], { detached: true, stdio: 'ignore', shell: codeBin === 'code' });
      ch.unref();
      return sendJson(res, 200, { opened: safeDir });
    }

    if (urlObj.pathname === '/context-artifact' && req.method === 'POST') {
      const { dirPath, fileName, content } = JSON.parse(await readBody(req));
      if (!ALLOWED_ARTIFACTS.has(fileName)) throw new Error('Ten tep khong duoc phep: ' + fileName);
      const dir = resolveInRoot(dirPath);
      const safeFile = path.join(dir, fileName);
      fs.writeFileSync(safeFile, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
      return sendJson(res, 200, { saved: safeFile });
    }

    res.writeHead(404);
    res.end();
  } catch (e) {
    sendJson(res, 400, { error: e.message });
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

