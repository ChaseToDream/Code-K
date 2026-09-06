import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppContext } from './useAppContext';
import { normalizeStocksCandles } from '../lib/kline-data';
import type { ServerMessage, StartParseMessage, StopParseMessage, RequestDiffDetail, DiffDetailMessage } from '../lib/types';

/**
 * 获取 WebSocket 连接地址
 * Electron 环境下使用 localhost，浏览器环境使用当前 hostname
 */
const getWsUrl = () => {
  const isElectron = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electron
  const host = isElectron ? 'localhost' : window.location.hostname
  return `ws://${host}:3001`
}

const WS_URL = getWsUrl();
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

// 模块级单例 — 所有组件共享同一个 WebSocket 连接
let wsInstance: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

// 订阅者集合
type ConnectedListener = (connected: boolean) => void;
type MessageListener = (message: ServerMessage) => void;
type DiffDetailListener = (message: DiffDetailMessage) => void;
type ReconnectListener = () => void;
const connectedListeners = new Set<ConnectedListener>();
const messageListeners = new Set<MessageListener>();
const diffDetailListeners = new Set<DiffDetailListener>();
const reconnectListeners = new Set<ReconnectListener>();

function notifyConnected(connected: boolean) {
  connectedListeners.forEach(fn => fn(connected));
}

function notifyMessage(message: ServerMessage) {
  messageListeners.forEach(fn => fn(message));
}

function notifyDiffDetail(message: DiffDetailMessage) {
  diffDetailListeners.forEach(fn => fn(message));
}

/** WS 恢复 open（含首次连接与断线重连）后触发 */
function notifyReconnected() {
  reconnectListeners.forEach(fn => fn());
}

function isWsOpen() {
  return wsInstance?.readyState === WebSocket.OPEN;
}

function createConnection() {
  if (wsInstance?.readyState === WebSocket.OPEN || wsInstance?.readyState === WebSocket.CONNECTING) return;

  console.log('[WebSocket] Connecting to', WS_URL);
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WebSocket] Connected');
    reconnectAttempts = 0;
    notifyConnected(true);
    notifyReconnected();
  };

  ws.onmessage = (event) => {
    try {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === 'diff_detail') {
        notifyDiffDetail(message);
      }
      notifyMessage(message);
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  };

  ws.onclose = () => {
    // 旧实例（reconnect() 中被替换）的 onclose 不再触发状态变更与重连
    if (wsInstance !== ws) return;
    console.log('[WebSocket] Disconnected');
    notifyConnected(false);
    wsInstance = null;

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts})`);
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        createConnection();
      }, RECONNECT_DELAY);
    } else {
      console.warn('[WebSocket] Max reconnect attempts reached, call reconnect() to retry manually');
    }
  };

  ws.onerror = (error) => {
    console.error('[WebSocket] Error:', error);
  };

  wsInstance = ws;
}

function closeConnection() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
  if (wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
}

/**
 * 手动重连：重置重连计数并立即建立新连接。
 * 自动重连放弃（10 次）后的手动入口。
 */
function reconnect() {
  reconnectAttempts = 0;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (wsInstance) {
    const stale = wsInstance;
    wsInstance = null;
    try {
      stale.close();
    } catch {
      // 已断开的连接 close 可能抛错，忽略
    }
  }
  createConnection();
}

export function useWebSocket() {
  const { dispatch } = useAppContext();
  const [isConnected, setIsConnected] = useState(isWsOpen());
  const dispatchRef = useRef(dispatch);

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // 订阅连接状态和消息
  useEffect(() => {
    const onConnected: ConnectedListener = (connected) => {
      setIsConnected(connected);
      dispatchRef.current({ type: 'SET_WS_CONNECTED', connected });
    };

    const onMessage: MessageListener = (message) => {
      console.log('[WebSocket] Received:', message.type);

      switch (message.type) {
        case 'progress':
          dispatchRef.current({
            type: 'UPDATE_REPO_PROGRESS',
            repoId: message.repoId,
            progress: {
              phase: message.phase,
              current: message.current,
              total: message.total,
              message: message.message,
              // 服务端 ETA 单位为秒，直接透传
              estimatedTimeRemaining: message.estimatedTimeRemaining,
            },
          });
          break;

        case 'partial':
          dispatchRef.current({
            type: 'UPDATE_REPO_STOCKS',
            repoId: message.repoId,
            stocks: normalizeStocksCandles(message.stocks),
          });
          break;

        case 'complete':
          dispatchRef.current({
            type: 'UPDATE_REPO_STOCKS',
            repoId: message.repoId,
            // 命中旧磁盘缓存（fromCache）时 candle 可能缺 additions/deletions，兜底为 0
            stocks: normalizeStocksCandles(message.stocks),
          });
          dispatchRef.current({
            type: 'SET_REPO_STATUS',
            repoId: message.repoId,
            status: 'ready',
          });
          break;

        case 'parse_started':
          dispatchRef.current({
            type: 'SET_REPO_STATUS',
            repoId: message.repoId,
            status: 'parsing',
          });
          break;

        case 'parse_stopped':
          if (message.repoId) {
            dispatchRef.current({
              type: 'SET_REPO_STATUS',
              repoId: message.repoId,
              status: 'idle',
            });
          }
          break;

        case 'error':
          if (message.repoId) {
            dispatchRef.current({
              type: 'SET_REPO_STATUS',
              repoId: message.repoId,
              status: 'error',
              error: message.message,
            });
          }
          console.error('[WebSocket] Server error:', message.message);
          break;

        case 'diff_detail':
          // 已通过 notifyDiffDetail 分发给 onDiffDetail 订阅者
          break;

        case 'commits_update':
          dispatchRef.current({
            type: 'APPEND_REPO_COMMITS',
            repoId: message.repoId,
            commits: message.commits,
          });
          console.log(`[WebSocket] Applied ${message.commits.length} new commits to ${message.repoName}`);
          break;
      }
    };

    connectedListeners.add(onConnected);
    messageListeners.add(onMessage);

    // 晚挂载的订阅者立即回放缓存状态，避免拿不到"已连接"
    if (isWsOpen()) {
      onConnected(true);
    }

    // 首次挂载时建立连接
    createConnection();

    return () => {
      connectedListeners.delete(onConnected);
      messageListeners.delete(onMessage);
    };
  }, []);

  const sendStartParse = useCallback((repoPath: string, repoName: string, maxCommits?: number) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      const message: StartParseMessage = {
        type: 'start_parse',
        repoPath,
        repoName,
        maxCommits,
      };
      wsInstance.send(JSON.stringify(message));
    } else {
      console.error('[WebSocket] Not connected');
    }
  }, []);

  const sendStopParse = useCallback((repoPath?: string) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      const message: StopParseMessage = { type: 'stop_parse' };
      if (repoPath) message.repoPath = repoPath;
      wsInstance.send(JSON.stringify(message));
    }
  }, []);

  const sendRequestDiff = useCallback((repoPath: string, commitHash: string, filePath: string) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      const message: RequestDiffDetail = {
        type: 'request_diff',
        repoPath,
        commitHash,
        filePath,
      };
      wsInstance.send(JSON.stringify(message));
    }
  }, []);

  /**
   * 订阅 diff_detail 消息；handler 需自行按 commitHash/filePath 过滤
   * @returns 取消订阅函数
   */
  const onDiffDetail = useCallback((handler: (msg: DiffDetailMessage) => void) => {
    diffDetailListeners.add(handler);
    return () => {
      diffDetailListeners.delete(handler);
    };
  }, []);

  /**
   * 订阅 WS 恢复 open 事件（首次连接与断线重连均触发）。
   * 晚挂载的订阅者注册时若连接已 OPEN，立即回放一次。
   * @returns 取消订阅函数
   */
  const onReconnect = useCallback((handler: () => void) => {
    reconnectListeners.add(handler);
    if (isWsOpen()) {
      handler();
    }
    return () => {
      reconnectListeners.delete(handler);
    };
  }, []);

  return {
    connect: createConnection,
    disconnect: closeConnection,
    reconnect,
    sendStartParse,
    sendStopParse,
    sendRequestDiff,
    onDiffDetail,
    onReconnect,
    isConnected,
  };
}
