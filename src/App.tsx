import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Laptop,
  Terminal,
  Send,
  CheckCircle2,
  RefreshCw,
  Copy,
  Check,
  Eye,
  MousePointerClick,
  FileCode2,
  Lock,
  Globe,
  Code2,
  MessageSquareCode,
  Bug,
  Wrench,
  Activity,
  Zap,
  Trash2,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Keyboard,
  Folder,
  FolderOpen,
  Square,
  Download,
  Video,
  FileText,
  GitBranch
} from 'lucide-react';

// ============================================================================
// 1. ĐỊNH NGHĨA BỘ TÁC NHÂN (bo-agent-chung-main) VÀ KIỂU DỮ LIỆU CHUẨN
// ============================================================================
export interface AgentPersona {
  id: string;
  name: string;
  badge: string;
  color: string;
  border: string;
  bg: string;
  text: string;
  description: string;
}

export interface HostInfo {
  ok: boolean;
  host: string;
  platform: string;
  lanIp: string;
  home: string;
  cdpPort: number;
}

export interface CdpTarget {
  id: string;
  title?: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface ClickMarker {
  percentX: number;
  percentY: number;
  realX: number;
  realY: number;
}

export interface DomMessage {
  role: 'user' | 'agent';
  text: string;
}

export interface DomButton {
  label: string;
  isPriority: boolean;
  x: number;
  y: number;
}

export interface CodeChange {
  title: string;
  content: string;
}

export interface FsFolder {
  name: string;
  path: string;
}

export interface FsContextMeta {
  hasClaude: boolean;
  hasAgents: boolean;
  handoffData: any;
  git: {
    isGit: boolean;
    branch: string | null;
    changes: string[];
  } | null;
}

export interface DevToolsLog {
  id: number;
  timestamp: string;
  source: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: any;
}

export interface DebuggerDiagnosis {
  status: 'healthy' | 'issue_found';
  title: string;
  rootCause: string;
  remediation: string[];
}

export interface PipelineStep {
  step: number;
  label: string;
  active: boolean;
}

const AGENT_PERSONAS: Record<string, AgentPersona> = {
  debugger: {
    id: 'debugger',
    name: 'Debugger Agent (Chromium DevTools)',
    badge: 'Chuyên gia Gỡ lỗi & DevTools',
    color: 'from-rose-500 to-amber-500',
    border: 'border-rose-500/40',
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    description: 'Bắt luồng console/exception từ Chromium CDP, phân tích Root Cause và đề xuất bản vá tức thì.'
  },
  backend_dev: {
    id: 'backend_dev',
    name: 'Backend Dev Agent',
    badge: 'Node Bridge & CDP Pipe',
    color: 'from-emerald-500 to-teal-500',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    description: 'Chuyên trách dịch vụ Node.js 9334, định tuyến /json/list, bảo mật PIN và chống injection.'
  },
  ui_implementer: {
    id: 'ui_implementer',
    name: 'UI Implementer Agent',
    badge: 'Mobile Ergonomics & PWA',
    color: 'from-cyan-500 to-blue-500',
    border: 'border-cyan-500/40',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    description: 'Khóa cứng bố cục di động 100dvh, chống rung lắc, tối ưu tap target theo chuẩn ngón tay cái.'
  },
  qa_reviewer: {
    id: 'qa_reviewer',
    name: 'QA Reviewer Agent',
    badge: 'Xác minh & Đánh giá rủi ro',
    color: 'from-purple-500 to-indigo-500',
    border: 'border-purple-500/40',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    description: 'Kiểm thử hộp đen các luồng CDP, rà soát 5 điều kiện bàn giao phiên và kiểm tra code review.'
  },
  release_ops: {
    id: 'release_ops',
    name: 'Release Ops Agent',
    badge: 'Cài đặt cai-dat.ps1 & Cloudflare',
    color: 'from-amber-500 to-orange-500',
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    description: 'Tự động hóa kịch bản PowerShell cai-dat.ps1, quản lý tiến trình chạy nền và Tunnel.'
  }
};

// Lenh khoi chay (script that nam tai cai-dat.ps1 trong kho ma nguon)
const RUN_COMMAND = 'powershell -ExecutionPolicy Bypass -File .\\cai-dat.ps1';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('connect');
  const [activeAgent, setActiveAgent] = useState<string>('debugger');
  const [hostAddress, setHostAddress] = useState<string>('127.0.0.1');
  const [vibePin, setVibePin] = useState<string>('');

  const [inputTargetMode, setInputTargetMode] = useState<'chat' | 'terminal'>('chat');

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  const [bridgeStatus, setBridgeStatus] = useState<'disconnected' | 'scanning' | 'connected' | 'error'>('disconnected');
  const [statusMessage, setStatusMessage] = useState<string>(
    isHttps
      ? 'Đang mở trên HTTPS: Hãy nhập IP LAN hoặc bật Cloudflare Tunnel rồi bấm Quét lại'
      : 'Sẵn sàng kết nối bộ tác nhân Chromium DevTools'
  );
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);

  const [targets, setTargets] = useState<CdpTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<CdpTarget | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [remoteViewport, setRemoteViewport] = useState<{ width: number; height: number }>({ width: 1280, height: 800 });
  const [lastClickMarker, setLastClickMarker] = useState<ClickMarker | null>(null);
  const [autoLiveStream, setAutoLiveStream] = useState<boolean>(false);
  const [touchClickEnabled, setTouchClickEnabled] = useState<boolean>(false);
  const [confirmCtrlC, setConfirmCtrlC] = useState<boolean>(false);

  const [liveDomMessages, setLiveDomMessages] = useState<DomMessage[]>([]);
  const [liveDomButtons, setLiveDomButtons] = useState<DomButton[]>([]);
  const [liveCodeChanges, setLiveCodeChanges] = useState<CodeChange[]>([]);
  const [liveTerminalText, setLiveTerminalText] = useState<string>('');
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>({ step: 0, label: 'Sẵn sàng nhận lệnh', active: false });

  const [currentFsPath, setCurrentFsPath] = useState<string>('');
  const [fsFolders, setFsFolders] = useState<FsFolder[]>([]);
  const [fsContextMeta, setFsContextMeta] = useState<FsContextMeta | null>(null);
  const [contextHandoffNotes, setContextHandoffNotes] = useState<string>('');

  const [isRecordingVideo, setIsRecordingVideo] = useState<boolean>(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const activeScreenshotImgRef = useRef<HTMLImageElement | null>(null);

  const [devToolsLogs, setDevToolsLogs] = useState<DevToolsLog[]>([]);
  const [devToolsFilter, setDevToolsFilter] = useState<'all' | 'error' | 'warn' | 'cdp'>('all');
  const [debuggerDiagnosis, setDebuggerDiagnosis] = useState<DebuggerDiagnosis | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);

  const [promptInput, setPromptInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string>('');
  const [realCdpRttMs, setRealCdpRttMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const cmdIdRef = useRef<number>(1);
  const pendingCallbacksRef = useRef<Map<number, { resolve: (val: any) => void; reject: (err: any) => void; timeout: any }>>(new Map());
  const isRefreshingRef = useRef<boolean>(false);

  // Dong bo va load truoc anh chup de dam bao canvas video khong bi trang khung hinh
  useEffect(() => {
    if (!screenshotBase64) {
      activeScreenshotImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      activeScreenshotImgRef.current = img;
    };
    img.src = `data:image/jpeg;base64,${screenshotBase64}`;
  }, [screenshotBase64]);

  // ==========================================================================
  // 3. CÁC HÀM XỬ LÝ ĐỊA CHỈ & SAO CHÉP
  // ==========================================================================
  const getCleanHost = useCallback(() => {
    const raw = (hostAddress || '127.0.0.1').trim();
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^wss?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');
  }, [hostAddress]);

  const getBridgeBaseUrl = useCallback(() => {
    const raw = (hostAddress || '127.0.0.1').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(raw)) {
      if (/:\d+$/.test(raw) || raw.includes('.trycloudflare.com') || raw.includes('.ngrok')) {
        return raw;
      }
      return `${raw}:9334`;
    }
    const clean = getCleanHost();
    return `http://${clean}:9334`;
  }, [hostAddress, getCleanHost]);

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 2200);
    } catch {}
  }, []);

  const addDevToolsLog = useCallback((source: string, level: 'info' | 'warn' | 'error', message: string, details: any = null) => {
    const timestamp = new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setDevToolsLogs((prev) => [
      {
        id: Date.now() + Math.random(),
        timestamp,
        source,
        level,
        message,
        details
      },
      ...prev.slice(0, 79)
    ]);
  }, []);

  const sendCdpRaw = useCallback(
    (method: string, params: Record<string, any> = {}, explicitTarget: CdpTarget | null = null): Promise<any> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        const activeTarget = explicitTarget || selectedTarget;
        const startedAt = performance.now();

        if (ws && ws.readyState === WebSocket.OPEN && !explicitTarget) {
          const id = cmdIdRef.current++;
          const timeout = setTimeout(() => {
            pendingCallbacksRef.current.delete(id);
            addDevToolsLog('CDP', 'error', `Timeout lệnh ${method} (>6000ms)`);
            reject(new Error(`Timeout lệnh CDP: ${method}`));
          }, 6000);

          pendingCallbacksRef.current.set(id, {
            resolve: (val: any) => {
              setRealCdpRttMs(Math.round(performance.now() - startedAt));
              resolve(val);
            },
            reject,
            timeout
          });

          ws.send(JSON.stringify({ id, method, params }));
          return;
        }

        if (activeTarget?.webSocketDebuggerUrl) {
          fetch(`${getBridgeBaseUrl()}/cdp`, {
            method: 'POST',
            signal: AbortSignal.timeout(9000),
            headers: { 'Content-Type': 'application/json', 'X-Vibe-Pin': vibePin },
            body: JSON.stringify({
              wsUrl: activeTarget.webSocketDebuggerUrl,
              method,
              params
            })
          })
            .then((r) => r.json())
            .then((data) => {
              if (!data.ok) throw new Error(data.error || 'CDP Relay Error');
              setRealCdpRttMs(data.rttMs || Math.round(performance.now() - startedAt));
              setWsConnected(true);
              resolve(data.result);
            })
            .catch((err: any) => {
              addDevToolsLog('CDP', 'error', `Lỗi Relay ${method}: ${err?.message || err}`);
              reject(err);
            });
          return;
        }

        reject(new Error('Chưa chọn mục tiêu CDP'));
      });
    },
    [addDevToolsLog, getBridgeBaseUrl, selectedTarget, vibePin]
  );

  // Hàng đợi tuần tự: mọi lệnh CDP chạy lần lượt, không xen kẽ (click/gõ phím/làm mới).
  const cdpQueueRef = useRef<Promise<any>>(Promise.resolve());
  const sendCdpCommand = useCallback(
    (method: string, params: Record<string, any> = {}, explicitTarget: CdpTarget | null = null): Promise<any> => {
      const run = () => sendCdpRaw(method, params, explicitTarget);
      const p = cdpQueueRef.current.then(run, run);
      cdpQueueRef.current = p.catch(() => {});
      return p;
    },
    [sendCdpRaw]
  );

  const inspectLiveVSCodeDOM = useCallback(
    async (explicitTarget: CdpTarget | null = null) => {
      const targetToUse = explicitTarget || selectedTarget;
      if (!targetToUse) return;

      const domExtractorScript = `(() => {
        const w = window.innerWidth || 1280;
        const h = window.innerHeight || 800;
        const docs = [document];
        try {
          document.querySelectorAll('iframe').forEach(ifr => {
            try { if (ifr.contentDocument) docs.push(ifr.contentDocument); } catch (e) {}
          });
        } catch (e) {}

        const messages = [];
        const seen = new Set();
        docs.forEach(doc => {
          doc.querySelectorAll('.interactive-item-container, .chat-markdown-part, .rendered-markdown, [class*="chat-message"]').forEach(node => {
            const txt = (node.innerText || '').trim();
            if (txt && txt.length > 3 && !seen.has(txt)) {
              seen.add(txt);
              const isUser = node.classList.contains('interactive-request') || !!node.closest('.interactive-request');
              messages.push({ role: isUser ? 'user' : 'agent', text: txt.slice(0, 1200) });
            }
          });
        });

        const buttons = [];
        docs.forEach(doc => {
          Array.from(doc.querySelectorAll('button, .monaco-button, [role="button"]'))
            .filter(b => b.offsetParent !== null)
            .slice(0, 60)
            .forEach(btn => {
              const label = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
              if (!label || label.length > 50) return;
              const r = btn.getBoundingClientRect();
              if (r.width > 12 && r.height > 12) {
                const isPriority = /Accept|Apply|Run|Allow|Approve|Send|Retry|Keep|Yes|Enter/i.test(label);
                buttons.push({
                  label,
                  isPriority,
                  x: Math.round(r.left + r.width / 2),
                  y: Math.round(r.top + r.height / 2)
                });
              }
            });
        });

        const codeBlocks = [];
        docs.forEach(doc => {
          doc.querySelectorAll('.interactive-result-code-block, .monaco-diff-editor, pre code').forEach((node, idx) => {
            const code = (node.innerText || '').trim();
            if (code && code.length > 20) {
              codeBlocks.push({ title: 'Khối mã #' + (idx + 1), content: code.slice(0, 1600) });
            }
          });
        });

        let terminalContent = '';
        docs.forEach(doc => {
          const rows = doc.querySelectorAll('.xterm-rows > div');
          if (rows && rows.length > 0) {
            const lines = Array.from(rows).map(r => (r.innerText || '').trimEnd()).filter(Boolean);
            terminalContent = lines.slice(-25).join('\\n');
          }
        });

        return {
          w,
          h,
          messages: messages.slice(-12),
          buttons: buttons.sort((a,b) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0)).slice(0, 24),
          codeBlocks: codeBlocks.slice(-6),
          terminalContent
        };
      })()`;

      try {
        const res: any = await sendCdpCommand(
          'Runtime.evaluate',
          { expression: domExtractorScript, returnByValue: true },
          targetToUse
        );
        const val = res?.result?.value;
        if (val) {
          setRemoteViewport({ width: val.w || 1280, height: val.h || 800 });
          setLiveDomMessages(val.messages || []);
          setLiveDomButtons(val.buttons || []);
          setLiveCodeChanges(val.codeBlocks || []);
          if (val.terminalContent) setLiveTerminalText(val.terminalContent);
        }
      } catch (err: any) {
        addDevToolsLog('Runtime', 'error', `Không thể trích xuất DOM: ${err?.message || err}`);
      }
    },
    [sendCdpCommand, selectedTarget, addDevToolsLog]
  );

  const captureLiveScreenshot = useCallback(
    async (explicitTarget: CdpTarget | null = null) => {
      const targetToUse = explicitTarget || selectedTarget;
      if (!targetToUse) return;
      try {
        const res: any = await sendCdpCommand(
          'Page.captureScreenshot',
          { format: 'jpeg', quality: 65 },
          targetToUse
        );
        if (res?.data) setScreenshotBase64(res.data);
      } catch {}
    },
    [sendCdpCommand, selectedTarget]
  );

  const refreshAllLiveState = useCallback(
    async (explicitTarget: CdpTarget | null = null) => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      try {
        await Promise.all([
          inspectLiveVSCodeDOM(explicitTarget),
          captureLiveScreenshot(explicitTarget)
        ]);
      } finally {
        isRefreshingRef.current = false;
      }
    },
    [inspectLiveVSCodeDOM, captureLiveScreenshot]
  );

  useEffect(() => {
    if (!autoLiveStream || !wsConnected || isSending) return;
    const timer = setInterval(() => {
      refreshAllLiveState();
    }, 2200);
    return () => clearInterval(timer);
  }, [autoLiveStream, wsConnected, isSending, refreshAllLiveState]);

  const attachToTarget = useCallback(
    (target: CdpTarget) => {
      if (!target?.webSocketDebuggerUrl) return;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }

      setSelectedTarget(target);
      setWsConnected(true);

      const cleanHost = getCleanHost();
      const wsUrl = target.webSocketDebuggerUrl.replace(
        /ws:\/\/(127\.0\.0\.1|localhost):9333/i,
        `ws://${cleanHost}:9333`
      );

      const isRemoteLan = cleanHost !== '127.0.0.1' && cleanHost !== 'localhost';
      if (isHttps || isRemoteLan) {
        addDevToolsLog('CDP', 'info', `Kích hoạt HTTP CDP Relay qua cổng 9334 cho mục tiêu: ${target.title || target.type}`);
        refreshAllLiveState(target);
        return;
      }

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
          setWsConnected(true);
          addDevToolsLog('CDP', 'info', `Đã gắn kết WebSocket trực tiếp: ${target.title || target.type}`);
          try {
            await sendCdpCommand('Runtime.enable', {}, target);
            await sendCdpCommand('Page.enable', {}, target);
            await sendCdpCommand('Console.enable', {}, target);
            await sendCdpCommand('Log.enable', {}, target);
            await sendCdpCommand('Network.enable', {}, target);
            await refreshAllLiveState(target);
          } catch {}
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.id && pendingCallbacksRef.current.has(msg.id)) {
              const { resolve, reject, timeout } = pendingCallbacksRef.current.get(msg.id)!;
              clearTimeout(timeout);
              pendingCallbacksRef.current.delete(msg.id);
              if (msg.error) reject(new Error(msg.error.message || 'CDP Error'));
              else resolve(msg.result);
              return;
            }
            if (msg.method === 'Runtime.exceptionThrown') {
              const details = msg.params?.exceptionDetails;
              const desc = details?.exception?.description || details?.text || 'Uncaught Exception';
              addDevToolsLog('Runtime', 'error', desc, details?.stackTrace);
            }
            if (msg.method === 'Console.messageAdded') {
              const entry = msg.params?.message;
              const lvl: 'error' | 'warn' | 'info' = entry?.level === 'error' ? 'error' : entry?.level === 'warning' ? 'warn' : 'info';
              addDevToolsLog('Console', lvl, `[${entry?.source}] ${entry?.text}`);
            }
          } catch {}
        };

        ws.onerror = () => {
          setWsConnected(true);
          addDevToolsLog('CDP', 'info', 'Chuyển sang HTTP CDP Relay qua cổng 9334.');
          refreshAllLiveState(target);
        };
      } catch {
        setWsConnected(true);
        refreshAllLiveState(target);
      }
    },
    [addDevToolsLog, getCleanHost, isHttps, refreshAllLiveState, sendCdpCommand]
  );

  const scanAndConnect = useCallback(async () => {
    const baseUrl = getBridgeBaseUrl();
    const cleanHost = getCleanHost();
    if (vibePin.trim().length < 6) {
      setBridgeStatus('error');
      setStatusMessage('Hãy nhập PIN (≥ 6 ký tự) do cai-dat.ps1 in ra.');
      return;
    }
    setBridgeStatus('scanning');
    setStatusMessage(`Đang quét ${cleanHost}:9334...`);
    addDevToolsLog('Bridge', 'info', `Gửi yêu cầu tới ${baseUrl}/health...`);

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 4000);

    try {
      const healthRes = await fetch(`${baseUrl}/health`, {
        headers: { 'X-Vibe-Pin': vibePin },
        signal: abortController.signal
      });
      clearTimeout(timer);

      if (healthRes.ok) {
        const health: HostInfo = await healthRes.json();
        setHostInfo(health);

        const jsonRes = await fetch(`${baseUrl}/json`, {
          headers: { 'X-Vibe-Pin': vibePin }
        });
        if (jsonRes.status === 401 || jsonRes.status === 429) {
          setBridgeStatus('error');
          setStatusMessage(jsonRes.status === 401 ? 'Sai mã PIN.' : 'Sai PIN quá nhiều lần, thử lại sau.');
          return;
        }
        const targetList: CdpTarget[] = await jsonRes.json();

        if (Array.isArray(targetList) && targetList.length > 0) {
          setTargets(targetList);
          setBridgeStatus('connected');
          setStatusMessage(`Đã kết nối ${health.host} (${targetList.length} tiến trình)`);
          const mainTarget =
            targetList.find(
              (t) =>
                t.type === 'page' &&
                (t.url?.includes('workbench.html') || t.title?.includes('Visual Studio Code'))
            ) ||
            targetList.find((t) => t.type === 'page') ||
            targetList[0];
          attachToTarget(mainTarget);
          setActiveTab('control');
          return;
        }
      }
    } catch (e: any) {
      clearTimeout(timer);
      addDevToolsLog('Bridge', 'error', `Không phản hồi từ ${baseUrl}: ${e?.message || e}`);
    }

    setBridgeStatus('error');
    setStatusMessage('Chưa phản hồi. Hãy chạy cai-dat.ps1 trên máy tính rồi thử lại.');
  }, [addDevToolsLog, attachToTarget, getBridgeBaseUrl, getCleanHost, vibePin]);

  const loadDirectory = useCallback(async (dirPath: string = '') => {
    try {
      const baseUrl = getBridgeBaseUrl();
      const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
      const res = await fetch(`${baseUrl}/fs${q}`, {
        headers: { 'X-Vibe-Pin': vibePin }
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentFsPath(data.currentPath);
        setFsFolders(data.folders || []);
        setFsContextMeta(data.contextMeta || null);
        addDevToolsLog('FS', 'info', `Đã tải thư mục: ${data.currentPath}`);
      }
    } catch (e: any) {
      addDevToolsLog('FS', 'error', `Lỗi tải thư mục: ${e?.message || e}`);
    }
  }, [getBridgeBaseUrl, vibePin, addDevToolsLog]);

  const openFolderInVSCode = async (folderPath: string) => {
    try {
      const baseUrl = getBridgeBaseUrl();
      const res = await fetch(`${baseUrl}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Vibe-Pin': vibePin },
        body: JSON.stringify({ folderPath })
      });
      if (res.ok) {
        addDevToolsLog('Host', 'info', `Đã mở thư mục trong VS Code: ${folderPath}`);
        setTimeout(() => scanAndConnect(), 1500);
      }
    } catch (e: any) {
      addDevToolsLog('Host', 'error', `Lỗi mở thư mục: ${e?.message || e}`);
    }
  };

  const saveContextArtifact = async (fileName: string, content: any) => {
    if (!currentFsPath) return;
    try {
      const baseUrl = getBridgeBaseUrl();
      const res = await fetch(`${baseUrl}/context-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Vibe-Pin': vibePin },
        body: JSON.stringify({ dirPath: currentFsPath, fileName, content })
      });
      if (res.ok) {
        addDevToolsLog('Context', 'info', `Đã lưu tệp ngữ cảnh: ${fileName}`);
        loadDirectory(currentFsPath);
      }
    } catch (e: any) {
      addDevToolsLog('Context', 'error', `Lỗi lưu tệp ngữ cảnh: ${e?.message || e}`);
    }
  };

  const startRecordingRealVideo = () => {
    if (isRecordingVideo) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        addDevToolsLog('Recorder', 'error', 'Không thể khởi tạo Canvas 2D context.');
        return;
      }

      const stream = canvas.captureStream(15);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        setIsRecordingVideo(false);
        addDevToolsLog('Recorder', 'info', 'Đã tạo video phiên làm việc thành công.');
      };

      const animTimer = setInterval(() => {
        if (!recorder || recorder.state !== 'recording') {
          clearInterval(animTimer);
          return;
        }
        ctx.fillStyle = '#080a0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#0c0f17';
        ctx.fillRect(0, 0, canvas.width, 36);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(16, 18, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`VibeCode Live Session - ${hostInfo?.host || 'PC'} (${realCdpRttMs || 0}ms)`, 32, 22);

        if (activeScreenshotImgRef.current) {
          try {
            ctx.drawImage(activeScreenshotImgRef.current, 10, 46, 380, 240);
          } catch {}
        }

        ctx.fillStyle = '#10141f';
        ctx.fillRect(400, 46, 230, 340);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('Nội dung DOM & Terminal:', 410, 64);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        const lines = liveDomMessages.slice(-5).map(m => m.text.slice(0, 28));
        lines.forEach((l, idx) => {
          ctx.fillText(`> ${l}`, 410, 85 + idx * 16);
        });

        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`Bước: ${pipelineStep.label}`, 16, 320);
      }, 100);

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingVideo(true);
      addDevToolsLog('Recorder', 'info', 'Bắt đầu ghi hình phiên kết nối.');
    } catch (e: any) {
      addDevToolsLog('Recorder', 'error', `Không thể ghi hình: ${e?.message || e}`);
    }
  };
  const stopRecordingRealVideo = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleLiveImageTouchClick = async (event: React.MouseEvent<HTMLImageElement>) => {
    if (!wsConnected) return;
    if (!touchClickEnabled) {
      addDevToolsLog('CDP', 'warn', 'Chế độ Chạm-để-Click đang TẮT để chống chạm nhầm. Hãy bật nút [Chạm Click: BẬT] nếu muốn click.');
      return;
    }
    const imgEl = event.currentTarget;
    const rect = imgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const ratioX = (event.clientX - rect.left) / rect.width;
    const ratioY = (event.clientY - rect.top) / rect.height;

    const realX = Math.round(ratioX * (remoteViewport.width || 1280));
    const realY = Math.round(ratioY * (remoteViewport.height || 800));

    setLastClickMarker({
      percentX: Math.round(ratioX * 100),
      percentY: Math.round(ratioY * 100),
      realX,
      realY
    });

    try {
      await sendCdpCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: realX,
        y: realY,
        button: 'left',
        clickCount: 1
      });
      await sendCdpCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: realX,
        y: realY,
        button: 'left',
        clickCount: 1
      });
      addDevToolsLog('CDP', 'info', `Đã click chuột tại tọa độ (${realX}, ${realY})`);
      setTimeout(() => refreshAllLiveState(), 450);
    } catch (err: any) {
      addDevToolsLog('CDP', 'error', `Lỗi click từ xa: ${err?.message || err}`);
    }
  };

  const sendRemoteScroll = async (deltaY: number) => {
    if (!wsConnected) return;
    const centerX = Math.round((remoteViewport.width || 1280) / 2);
    const centerY = Math.round((remoteViewport.height || 800) / 2);
    try {
      await sendCdpCommand('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: centerX,
        y: centerY,
        deltaX: 0,
        deltaY
      });
      setTimeout(() => refreshAllLiveState(), 400);
    } catch (err: any) {
      addDevToolsLog('CDP', 'error', `Lỗi cuộn trang: ${err?.message || err}`);
    }
  };

  const sendRemoteSpecialKey = async (keyLabel: string) => {
    if (!wsConnected) return;
    const keyMap: Record<string, { key: string; code: string; keyCode: number; text?: string; modifiers?: number }> = {
      Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
      Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
      Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
      Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      'Ctrl+C': { key: 'c', code: 'KeyC', keyCode: 67, modifiers: 2 },
      'Ctrl+S': { key: 's', code: 'KeyS', keyCode: 83, modifiers: 2 }
    };
    const cfg = keyMap[keyLabel];
    if (!cfg) return;

    try {
      await sendCdpCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode: cfg.keyCode,
        key: cfg.key,
        code: cfg.code,
        text: cfg.text || undefined,
        modifiers: cfg.modifiers || 0
      });
      await sendCdpCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: cfg.keyCode,
        key: cfg.key,
        code: cfg.code,
        modifiers: cfg.modifiers || 0
      });
      addDevToolsLog('CDP', 'info', `Đã gửi phím vật lý [${keyLabel}]`);
      setTimeout(() => refreshAllLiveState(), 450);
    } catch (err: any) {
      addDevToolsLog('CDP', 'error', `Lỗi gửi phím ${keyLabel}: ${err?.message || err}`);
    }
  };

  const injectPromptToVSCode = async (rawText: string) => {
    if (!rawText.trim() || !wsConnected || isSending) return;
    setIsSending(true);

    try {
      if (inputTargetMode === 'terminal') {
        setPipelineStep({ step: 1, label: '1/3: Focus Terminal xterm', active: true });
        await sendCdpCommand('Runtime.evaluate', {
          expression: `(() => {
            const termInput = document.querySelector('.xterm-helper-textarea');
            if (termInput) { termInput.focus(); return { found: true }; }
            return { found: false };
          })()`,
          returnByValue: true
        });
        await new Promise((r) => setTimeout(r, 250));

        setPipelineStep({ step: 2, label: '2/3: Gửi dòng lệnh vào Terminal', active: true });
        await sendCdpCommand('Input.insertText', { text: rawText.trim() });
        await new Promise((r) => setTimeout(r, 250));

        setPipelineStep({ step: 3, label: '3/3: Thực thi Enter', active: true });
        await sendCdpCommand('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          windowsVirtualKeyCode: 13,
          text: '\r',
          key: 'Enter',
          code: 'Enter'
        });
        await sendCdpCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          windowsVirtualKeyCode: 13,
          key: 'Enter',
          code: 'Enter'
        });

        setPromptInput('');
        setPipelineStep({ step: 4, label: 'Đã gửi lệnh vào Terminal CLI!', active: false });
        setTimeout(() => refreshAllLiveState(), 1000);
        return;
      }

      setPipelineStep({ step: 1, label: '1/4: Click-First Focus (500ms)', active: true });
      const focusResult: any = await sendCdpCommand('Runtime.evaluate', {
        expression: `(() => {
          const selectors = ['.interactive-input-part textarea.inputarea', '.interactive-input-part [role="textbox"]', 'textarea.inputarea', 'textarea'];
          for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
            const target = els.reverse().find(el => el.getBoundingClientRect().width > 10);
            if (target) {
              target.focus();
              const r = target.getBoundingClientRect();
              return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          }
          return { found: false };
        })()`,
        returnByValue: true
      });

      const info = focusResult?.result?.value;
      if (info?.found) {
        await sendCdpCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: info.x,
          y: info.y,
          button: 'left',
          clickCount: 1
        });
        await sendCdpCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: info.x,
          y: info.y,
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 500));
      }

      setPipelineStep({ step: 2, label: '2/4: IME insertText (500ms)', active: true });
      await sendCdpCommand('Input.insertText', { text: rawText.trim() });
      await new Promise((r) => setTimeout(r, 500));

      setPipelineStep({ step: 3, label: '3/4: Kiểm tra nút Send & Recovery Dance', active: true });
      const checkLock: any = await sendCdpCommand('Runtime.evaluate', {
        expression: `(() => {
          const btns = Array.from(document.querySelectorAll('button, .monaco-button, [role="button"]'))
            .filter(b => /Send|Submit|Gửi/i.test(b.innerText || b.getAttribute('aria-label') || b.getAttribute('title') || ''));
          const isLocked = btns.some(b => b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('disabled'));
          return { isLocked };
        })()`,
        returnByValue: true
      });

      if (checkLock?.result?.value?.isLocked) {
        addDevToolsLog('Debugger', 'info', 'Nút Send bị khóa -> Kích hoạt Recovery Dance (End -> Space -> Backspace)');
        await sendCdpCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 35, key: 'End', code: 'End' });
        await sendCdpCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 35, key: 'End', code: 'End' });
        await sendCdpCommand('Input.insertText', { text: ' ' });
        await sendCdpCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' });
        await sendCdpCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' });
        await new Promise((r) => setTimeout(r, 250));
      }

      setPipelineStep({ step: 4, label: '4/4: Dispatch Enter', active: true });
      await sendCdpCommand('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode: 13,
        text: '\r',
        key: 'Enter',
        code: 'Enter'
      });
      await sendCdpCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter'
      });

      setPromptInput('');
      setPipelineStep({ step: 4, label: 'Đã hoàn tất gửi lệnh!', active: false });
      setTimeout(() => refreshAllLiveState(), 1100);
    } catch (err: any) {
      addDevToolsLog('CDP', 'error', `Thất bại khi gửi lệnh: ${err?.message || err}`);
      setPipelineStep({ step: 0, label: `Lỗi: ${err?.message || err}`, active: false });
    } finally {
      setIsSending(false);
    }
  };

  const runDebuggerAgentAnalysis = () => {
    setIsDiagnosing(true);
    const recentErrors = devToolsLogs.filter((l) => l.level === 'error').slice(0, 5);

    setTimeout(() => {
      if (recentErrors.length === 0) {
        setDebuggerDiagnosis({
          status: 'healthy',
          title: 'Hệ thống hoạt động ổn định',
          rootCause: 'Không phát hiện lỗi runtime hoặc ngoại lệ nghiêm trọng nào trong phiên Chromium DevTools.',
          remediation: [
            'Duy trì kết nối qua cổng Relay 9334.',
            'Tiếp tục theo dõi luồng tin nhắn, Terminal và thay đổi mã nguồn.'
          ]
        });
      } else {
        const first = recentErrors[0];
        let cause = `Ngoại lệ phát sinh tại nguồn [${first.source}]: ${first.message}`;
        let steps = [
          'Đảm bảo kịch bản cai-dat.ps1 đang chạy trên máy tính.',
          'Bấm "Quét lại" trên thanh tiêu đề để đồng bộ danh sách tiến trình mới nhất.',
          'Thử gửi lại lệnh hoặc dùng tab Live View để chạm trực tiếp vào ô nhập liệu.'
        ];

        if (first.message.includes('Failed to fetch') || isHttps) {
          cause = 'Trình duyệt đang chặn kết nối từ HTTPS xuống HTTP cục bộ (Mixed Content) hoặc dịch vụ 9334 chưa bật.';
          steps = [
            'Chạy kịch bản cai-dat.ps1 trong PowerShell trên máy tính.',
            'Mở trực tiếp địa chỉ http://127.0.0.1:9334 (trên PC) hoặc http://<IP-LAN>:9334 (trên điện thoại).',
            'Sử dụng Cloudflare Tunnel (cloudflared tunnel --url http://127.0.0.1:9334) để có domain HTTPS bảo mật.'
          ];
        }

        setDebuggerDiagnosis({
          status: 'issue_found',
          title: `Phát hiện lỗi: ${first.source}`,
          rootCause: cause,
          remediation: steps
        });
      }
      setIsDiagnosing(false);
    }, 500);
  };

  const filteredLogs = devToolsLogs.filter((log) => {
    if (devToolsFilter === 'all') return true;
    if (devToolsFilter === 'error') return log.level === 'error';
    if (devToolsFilter === 'warn') return log.level === 'warn';
    if (devToolsFilter === 'cdp') return log.source === 'CDP';
    return true;
  });

  return (
    <div className="fixed inset-0 w-full max-w-full h-[100dvh] bg-[#080a0f] text-zinc-100 flex flex-col overflow-hidden select-none font-sans">
      <header className="shrink-0 h-13 px-3 bg-[#0c0f17] border-b border-zinc-800 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
            <Bug className="w-4 h-4 text-rose-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-xs sm:text-sm font-bold text-white truncate">VibeCode Universal Cockpit</h1>
              <span
                className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                  wsConnected
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {wsConnected ? `CDP ${realCdpRttMs ? `${realCdpRttMs}ms` : 'Sẵn sàng'}` : 'Chưa kết nối'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 truncate">{statusMessage}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={scanAndConnect}
            className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-semibold flex items-center gap-1 shadow active:scale-95 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bridgeStatus === 'scanning' ? 'animate-spin' : ''}`} />
            <span>Quét lại</span>
          </button>
        </div>
      </header>

      <div className="shrink-0 bg-[#0e121c] border-b border-zinc-800/80 px-2 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {Object.values(AGENT_PERSONAS).map((ag) => {
          const isActive = activeAgent === ag.id;
          return (
            <button
              key={ag.id}
              type="button"
              onClick={() => setActiveAgent(ag.id)}
              className={`shrink-0 px-2.5 py-1 rounded-xl text-[11px] font-medium transition flex items-center gap-1.5 border ${
                isActive
                  ? `${ag.bg} ${ag.border} ${ag.text} font-bold`
                  : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Zap className={`w-3 h-3 ${isActive ? ag.text : 'text-zinc-500'}`} />
              <span>{ag.name.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>

      <main className="flex-1 min-h-0 w-full overflow-hidden relative">
        {activeTab === 'connect' && (
          <div className="h-full w-full overflow-y-auto p-3 space-y-3">
            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  Kịch bản Cài đặt cai-dat.ps1 Hoàn Chỉnh
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-amber-300 font-mono">
                  Relay 9334
                </span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                Chạy lệnh dưới đây trong thư mục dự án trên máy tính. Script mở cổng <code>9333</code> (chỉ máy này), bật Host Bridge <code>9334</code> và in ra mã PIN ngẫu nhiên cho phiên. Thêm <code>-Lan</code> để dùng trong mạng nội bộ hoặc <code>-Tunnel</code> để dùng qua Cloudflare.
              </p>

              <button
                type="button"
                onClick={() => copyToClipboard(RUN_COMMAND, 'ps1_script')}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow active:scale-98 transition"
              >
                {copiedId === 'ps1_script' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>
                  {copiedId === 'ps1_script'
                    ? 'ĐÃ CHÉP LỆNH KHỞI CHẠY!'
                    : 'CHÉP LỆNH KHỞI CHẠY (1-CHẠM)'}
                </span>
              </button>
            </div>

            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3 space-y-2">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  Địa chỉ Máy Chủ & PIN
                </span>
                <span className="text-[10px] text-zinc-400">
                  {hostInfo ? `${hostInfo.host} (${hostInfo.lanIp})` : 'PC / Surface 7'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 bg-[#080a0f] border border-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-zinc-400 shrink-0" />
                  <input
                    type="text"
                    value={hostAddress}
                    onChange={(e) => setHostAddress(e.target.value)}
                    placeholder="127.0.0.1 hoặc 192.168.1.x"
                    className="w-full bg-transparent text-xs text-white outline-none font-mono"
                  />
                </div>
                <div className="bg-[#080a0f] border border-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <input
                    type="password"
                    value={vibePin}
                    onChange={(e) => setVibePin(e.target.value)}
                    placeholder="PIN"
                    className="w-full bg-transparent text-xs text-amber-300 outline-none font-mono"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={scanAndConnect}
                className="w-full py-2 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${bridgeStatus === 'scanning' ? 'animate-spin' : ''}`} />
                Quét & Kết Nối Tức Thì
              </button>
            </div>

            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3 space-y-2">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span>Mục tiêu Chromium CDP ({targets.length})</span>
                {wsConnected && (
                  <span className="text-[10px] text-emerald-400 font-mono">
                    RTT: {realCdpRttMs ?? '--'}ms
                  </span>
                )}
              </div>

              {targets.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3 text-center">
                  Chưa phát hiện mục tiêu. Hãy chạy <code>cai-dat.ps1</code> trên máy tính rồi bấm Quét lại.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {targets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        attachToTarget(t);
                        setActiveTab('control');
                      }}
                      className={`w-full p-2 rounded-xl border text-left flex items-center justify-between gap-2 ${
                        selectedTarget?.id === t.id
                          ? 'bg-rose-500/15 border-rose-500/50 text-white'
                          : 'bg-[#080a0f] border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate">{t.title || t.url || t.id}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{t.type}</div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-rose-300">
                        Nối
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'control' && (
          <div className="h-full w-full flex flex-col p-3 gap-2 overflow-hidden">
            <div className="shrink-0 bg-[#10141f] border border-zinc-800 rounded-xl p-1.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setInputTargetMode('chat')}
                className={`py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  inputTargetMode === 'chat'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <MessageSquareCode className="w-3.5 h-3.5" />
                <span>Ô Chat AI (Webview)</span>
              </button>
              <button
                type="button"
                onClick={() => setInputTargetMode('terminal')}
                className={`py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  inputTargetMode === 'terminal'
                    ? 'bg-amber-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Terminal CLI (Claude/Codex)</span>
              </button>
            </div>

            <div className="shrink-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Nút bấm DOM trong VS Code ({liveDomButtons.length})
                </span>
                <button
                  type="button"
                  onClick={() => refreshAllLiveState()}
                  className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-white"
                >
                  Làm mới DOM
                </button>
              </div>

              {liveDomButtons.length === 0 ? (
                <div className="text-[11px] text-zinc-500">
                  {wsConnected ? 'Chưa phát hiện nút bấm trong vùng hiển thị.' : 'Chưa kết nối tới VS Code.'}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {liveDomButtons.map((btn, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={async () => {
                        await sendCdpCommand('Input.dispatchMouseEvent', {
                          type: 'mousePressed',
                          x: btn.x,
                          y: btn.y,
                          button: 'left',
                          clickCount: 1
                        });
                        await sendCdpCommand('Input.dispatchMouseEvent', {
                          type: 'mouseReleased',
                          x: btn.x,
                          y: btn.y,
                          button: 'left',
                          clickCount: 1
                        });
                        setTimeout(() => refreshAllLiveState(), 500);
                      }}
                      className={`shrink-0 px-2.5 py-1 rounded-xl text-xs font-medium border ${
                        btn.isPriority
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-[#080a0f] border-zinc-800 text-zinc-300'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-3 flex flex-col overflow-hidden">
              <div className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                <span>
                  {inputTargetMode === 'terminal'
                    ? 'Luồng chữ Terminal tích hợp (xterm)'
                    : `Luồng hội thoại DOM (${liveDomMessages.length})`}
                </span>
                <span className="text-[10px] text-amber-400 truncate max-w-[50%]">
                  {pipelineStep.label}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {inputTargetMode === 'terminal' ? (
                  liveTerminalText ? (
                    <pre className="p-2.5 rounded-xl bg-[#06080c] border border-zinc-800 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-words">
                      {liveTerminalText}
                    </pre>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-zinc-500 text-center px-4">
                      Đang chờ dữ liệu từ Terminal VS Code. Bạn vẫn có thể gửi lệnh hoặc phím y/n/Enter bên dưới.
                    </div>
                  )
                ) : liveDomMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-zinc-500 text-center">
                    {wsConnected ? 'Đang lắng nghe tin nhắn trong ô chat...' : 'Chưa kết nối tới VS Code.'}
                  </div>
                ) : (
                  liveDomMessages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl text-xs whitespace-pre-wrap break-words border ${
                        m.role === 'user'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-100 ml-4'
                          : 'bg-[#080a0f] border-zinc-800 text-zinc-200 mr-2'
                      }`}
                    >
                      {m.text}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="shrink-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-2 flex items-center gap-2">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') injectPromptToVSCode(promptInput);
                }}
                disabled={!wsConnected || isSending}
                placeholder={
                  !wsConnected
                    ? 'Chưa kết nối...'
                    : inputTargetMode === 'terminal'
                    ? 'Nhập lệnh CLI (hoặc y / n) gửi vào Terminal...'
                    : 'Nhập lệnh gửi vào ô Chat VS Code...'
                }
                className="flex-1 bg-[#080a0f] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
              <button
                type="button"
                onClick={() => injectPromptToVSCode(promptInput)}
                disabled={!wsConnected || !promptInput.trim() || isSending}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Gửi</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'devtools' && (
          <div className="h-full w-full flex flex-col p-3 gap-2.5 overflow-hidden">
            <div className="shrink-0 bg-[#10141f] border border-rose-500/30 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wrench className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-bold text-white">Chẩn Đoán Debugger Agent</span>
                </div>
                <button
                  type="button"
                  onClick={runDebuggerAgentAnalysis}
                  disabled={isDiagnosing}
                  className="px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center gap-1"
                >
                  <Activity className={`w-3.5 h-3.5 ${isDiagnosing ? 'animate-spin' : ''}`} />
                  <span>{isDiagnosing ? 'Đang quét...' : 'Phân tích lỗi ngay'}</span>
                </button>
              </div>

              {debuggerDiagnosis ? (
                <div className="bg-[#080a0f] border border-zinc-800 rounded-xl p-2.5 space-y-1.5 text-xs">
                  <div className="font-bold text-rose-300">{debuggerDiagnosis.title}</div>
                  <div className="text-zinc-300 text-[11px] leading-relaxed">
                    <strong>Nguyên nhân gốc (Root Cause):</strong> {debuggerDiagnosis.rootCause}
                  </div>
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase">Phương án khắc phục:</span>
                    {debuggerDiagnosis.remediation.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-[11px] text-emerald-300">
                        <ArrowRight className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-zinc-500">
                  Bấm "Phân tích lỗi ngay" để Debugger Agent quét toàn bộ luồng ngoại lệ và đưa ra giải pháp.
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-3 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Bug className="w-3.5 h-3.5 text-amber-400" />
                  Nhật ký DevTools ({filteredLogs.length})
                </span>

                <div className="flex items-center gap-1">
                  {(['all', 'error', 'warn', 'cdp'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setDevToolsFilter(f)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] uppercase font-mono ${
                        devToolsFilter === f
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDevToolsLogs([])}
                    className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300"
                    title="Xóa nhật ký"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 font-mono text-[11px] pr-1">
                {filteredLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
                    Chưa có sự kiện nào được ghi nhận từ Chromium.
                  </div>
                ) : (
                  filteredLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2 rounded-xl border ${
                        log.level === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                          : log.level === 'warn'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : 'bg-[#080a0f] border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                        <span className="font-bold text-zinc-400">[{log.source}]</span>
                        <span>{log.timestamp}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{log.message}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="h-full w-full overflow-y-auto p-3 space-y-3">
            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-cyan-400" />
                  Duyệt Dự Án Ổ Cứng Máy Chủ
                </span>
                <button
                  type="button"
                  onClick={() => loadDirectory(currentFsPath)}
                  className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300"
                >
                  Tải thư mục
                </button>
              </div>

              <div className="text-[11px] font-mono text-zinc-400 truncate bg-[#080a0f] p-2 rounded-xl border border-zinc-800">
                {currentFsPath || 'Bấm tải thư mục để bắt đầu'}
              </div>

              {fsFolders.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {fsFolders.map((f, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openFolderInVSCode(f.path)}
                      className="p-1.5 rounded-lg bg-[#080a0f] border border-zinc-800 hover:border-cyan-500/50 text-left flex items-center gap-1.5 truncate text-[11px] text-zinc-300"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  Context Studio (Tầng 1 & 5)
                </span>
                {fsContextMeta?.git?.isGit && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {fsContextMeta.git.branch}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    saveContextArtifact(
                      'CLAUDE.md',
                      `# Project Rules\n- Giữ code ngắn gọn, rõ ràng\n- Kiểm tra type check trước khi commit\n`
                    )
                  }
                  className="flex-1 py-1.5 rounded-xl bg-[#080a0f] border border-zinc-800 hover:border-emerald-500/50 text-[11px] text-emerald-300 font-semibold"
                >
                  Tạo CLAUDE.md (Level 1)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    saveContextArtifact('.vibe-session-handoff.json', {
                      timestamp: new Date().toISOString(),
                      notes: contextHandoffNotes || 'Bàn giao phiên từ di động',
                      gitState: fsContextMeta?.git || null
                    })
                  }
                  className="flex-1 py-1.5 rounded-xl bg-[#080a0f] border border-zinc-800 hover:border-amber-500/50 text-[11px] text-amber-300 font-semibold"
                >
                  Lưu Bàn Giao (.json)
                </button>
              </div>

              <textarea
                value={contextHandoffNotes}
                onChange={(e) => setContextHandoffNotes(e.target.value)}
                placeholder="Ghi chú bàn giao công việc trước khi kết thúc phiên..."
                className="w-full h-16 bg-[#080a0f] border border-zinc-800 rounded-xl p-2 text-xs text-white outline-none resize-none"
              />
            </div>

            <div className="bg-[#10141f] border border-zinc-800 rounded-2xl p-3 space-y-2">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <FileCode2 className="w-4 h-4 text-amber-400" />
                  Khối mã trích xuất trực tiếp ({liveCodeChanges.length})
                </span>
                <button
                  type="button"
                  onClick={() => refreshAllLiveState()}
                  className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300"
                >
                  Quét lại Code
                </button>
              </div>

              {liveCodeChanges.length === 0 ? (
                <div className="text-xs text-zinc-500 py-4 text-center">
                  Chưa phát hiện khối mã mới. Khi AI sinh mã hoặc mở Diff Editor, nội dung sẽ hiện tại đây.
                </div>
              ) : (
                <div className="space-y-2">
                  {liveCodeChanges.map((b, idx) => (
                    <div key={idx} className="bg-[#07090e] border border-zinc-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[11px] font-bold text-amber-300">{b.title}</div>
                      <pre className="text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-56 overflow-y-auto">
                        {b.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'live' && (
          <div className="h-full w-full flex flex-col p-3 gap-2.5 overflow-hidden">
            <div className="shrink-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => refreshAllLiveState()}
                  disabled={!wsConnected}
                  className="px-2.5 py-1 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40"
                >
                  Chụp ngay
                </button>
                <button
                  type="button"
                  onClick={() => setAutoLiveStream((v) => !v)}
                  disabled={!wsConnected}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold border ${
                    autoLiveStream
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-[#080a0f] border-zinc-800 text-zinc-400'
                  }`}
                >
                  {autoLiveStream ? 'Auto: BẬT' : 'Auto: TẮT'}
                </button>

                <button
                  type="button"
                  onClick={isRecordingVideo ? stopRecordingRealVideo : startRecordingRealVideo}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1 border ${
                    isRecordingVideo
                      ? 'bg-rose-600 text-white animate-pulse border-rose-500'
                      : 'bg-[#080a0f] border-zinc-800 text-rose-300'
                  }`}
                >
                  {isRecordingVideo ? <Square className="w-3 h-3" /> : <Video className="w-3 h-3" />}
                  <span>{isRecordingVideo ? 'Dừng' : 'Quay'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => sendRemoteScroll(-360)}
                  disabled={!wsConnected}
                  className="px-2 py-1 rounded-lg bg-[#080a0f] border border-zinc-800 text-xs text-zinc-300 flex items-center gap-0.5 active:scale-95"
                  title="Cuộn lên"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Lên</span>
                </button>
                <button
                  type="button"
                  onClick={() => sendRemoteScroll(360)}
                  disabled={!wsConnected}
                  className="px-2 py-1 rounded-lg bg-[#080a0f] border border-zinc-800 text-xs text-zinc-300 flex items-center gap-0.5 active:scale-95"
                  title="Cuộn xuống"
                >
                  <ArrowDown className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Xuống</span>
                </button>
              </div>
            </div>

            {recordedVideoUrl && (
              <div className="shrink-0 bg-[#10141f] border border-emerald-500/40 rounded-2xl p-2 flex items-center justify-between">
                <span className="text-xs text-emerald-300 font-semibold flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5" />
                  Video phiên đã hoàn tất
                </span>
                <a
                  href={recordedVideoUrl}
                  download="vibecode-live-session.webm"
                  className="px-2.5 py-1 rounded-xl bg-emerald-600 text-white text-[11px] font-bold flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  <span>Tải về</span>
                </a>
              </div>
            )}

            <div className="flex-1 min-h-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-2 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1">
                    <MousePointerClick className="w-3.5 h-3.5 text-amber-400" />
                    Chạm ảnh để Click:
                  </span>
                  <button
                    type="button"
                    onClick={() => setTouchClickEnabled((v) => !v)}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition ${
                      touchClickEnabled
                        ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                        : 'bg-[#080a0f] border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {touchClickEnabled ? 'BẬT (Click thật)' : 'TẮT (Khóa chống chạm)'}
                  </button>
                </div>
                {lastClickMarker && (
                  <span className="font-mono text-[10px] text-emerald-400">
                    ({lastClickMarker.realX}, {lastClickMarker.realY})
                  </span>
                )}
              </div>

              <div className="flex-1 min-h-0 bg-black rounded-xl border border-zinc-800 flex items-center justify-center overflow-hidden relative">
                {screenshotBase64 ? (
                  <div className="relative inline-block max-w-full max-h-full">
                    <img
                      src={`data:image/jpeg;base64,${screenshotBase64}`}
                      alt="VS Code Live Frame"
                      onClick={handleLiveImageTouchClick}
                      className="max-w-full max-h-[50dvh] object-contain cursor-crosshair select-none"
                    />
                    {lastClickMarker && (
                      <span
                        style={{
                          left: `${lastClickMarker.percentX}%`,
                          top: `${lastClickMarker.percentY}%`
                        }}
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-rose-500 bg-rose-500/30 animate-ping"
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 py-8 text-center px-4">
                    {wsConnected
                      ? 'Bấm "Chụp ngay" hoặc bật "Auto" để xem và chạm điều khiển màn hình VS Code.'
                      : 'Chưa kết nối tới VS Code.'}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 bg-[#10141f] border border-zinc-800 rounded-2xl p-2 flex items-center gap-1.5 overflow-x-auto">
              <span className="text-[10px] text-zinc-400 flex items-center gap-1 shrink-0 px-1">
                <Keyboard className="w-3.5 h-3.5 text-amber-400" />
                Phím:
              </span>
              {['Enter', 'Escape', 'Tab', 'Backspace', 'Ctrl+S', 'Ctrl+C'].map((k) => {
                const isCtrlC = k === 'Ctrl+C';
                const isArmed = isCtrlC && confirmCtrlC;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (isCtrlC && !confirmCtrlC) {
                        setConfirmCtrlC(true);
                        setTimeout(() => setConfirmCtrlC(false), 3000);
                        return;
                      }
                      if (isCtrlC) {
                        setConfirmCtrlC(false);
                      }
                      sendRemoteSpecialKey(k);
                    }}
                    disabled={!wsConnected}
                    className={`shrink-0 px-2.5 py-1 rounded-xl text-xs font-mono active:scale-95 disabled:opacity-40 transition border ${
                      isArmed
                        ? 'bg-rose-600 text-white border-rose-400 font-bold animate-pulse'
                        : 'bg-[#080a0f] border-zinc-700 hover:border-amber-500/50 text-zinc-200'
                    }`}
                  >
                    {isArmed ? 'DỪNG TIẾN TRÌNH? (BẤM LẠI)' : k}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <nav className="shrink-0 h-14 bg-[#0c0f17] border-t border-zinc-800 grid grid-cols-5 px-1 z-20">
        {[
          { id: 'connect', label: 'Kết nối', icon: Globe },
          { id: 'control', label: 'Điều khiển', icon: MessageSquareCode },
          { id: 'devtools', label: 'DevTools', icon: Bug },
          { id: 'code', label: 'Màn Code', icon: Code2 },
          { id: 'live', label: 'Live View', icon: Eye }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 transition ${
                isActive ? 'text-rose-400 font-bold' : 'text-zinc-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px]">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
