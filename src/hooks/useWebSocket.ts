import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppContext } from './useAppContext';
import type { ServerMessage, StartParseMessage, RequestDiffDetail } from '../lib/types';

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
const connectedListeners = new Set<ConnectedListener>();
const messageListeners = new Set<MessageListener>();

function notifyConnected(connected: boolean) {
  connectedListeners.forEach(fn => fn(connected));
}

function notifyMessage(message: ServerMessage) {
  messageListeners.forEach(fn => fn(message));
}

function createConnection() {
  if (wsInstance?.readyState === WebSocket.OPEN || wsInstance?.readyState === WebSocket.CONNECTING) return;

  console.log('[WebSocket] Connecting to', WS_URL);
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WebSocket] Connected');
    reconnectAttempts = 0;
    notifyConnected(true);
  };

  ws.onmessage = (event) => {
    try {
      const message: ServerMessage = JSON.parse(event.data);
      notifyMessage(message);
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  };

  ws.onclose = () => {
    console.log('[WebSocket] Disconnected');
    notifyConnected(false);
    wsInstance = null;

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttempts})`);
      reconnectTimeout = setTimeout(() => {
        createConnection();
      }, RECONNECT_DELAY);
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

export function useWebSocket() {
  const { dispatch } = useAppContext();
  const [isConnected, setIsConnected] = useState(false);
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
            },
          });
          break;

        case 'partial':
          dispatchRef.current({
            type: 'UPDATE_REPO_STOCKS',
            repoId: message.repoId,
            stocks: message.stocks,
          });
          break;

        case 'complete':
          dispatchRef.current({
            type: 'UPDATE_REPO_STOCKS',
            repoId: message.repoId,
            stocks: message.stocks,
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
          // TODO: 将 diff 数据传递给 DiffViewer 组件
          console.log('[WebSocket] Diff detail received for', message.filePath);
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

  const sendStopParse = useCallback(() => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify({ type: 'stop_parse' }));
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

  return {
    connect: createConnection,
    disconnect: closeConnection,
    sendStartParse,
    sendStopParse,
    sendRequestDiff,
    isConnected,
  };
}