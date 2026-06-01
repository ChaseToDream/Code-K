import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppContext } from './useAppContext';
import type { ServerMessage, StartParseMessage, RequestDiffDetail } from '../lib/types';

const WS_URL = `ws://${window.location.hostname}:3001`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { dispatch } = useAppContext();
  const [isConnected, setIsConnected] = useState(false);

  // 使用 ref 来存储 connect 函数，避免循环依赖
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[WebSocket] Connecting to', WS_URL);
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      reconnectAttemptsRef.current = 0;
      setIsConnected(true);
      dispatch({ type: 'SET_WS_CONNECTED', connected: true });
    };

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        console.log('[WebSocket] Received:', message.type);

        switch (message.type) {
          case 'progress':
            dispatch({
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
            dispatch({
              type: 'UPDATE_REPO_STOCKS',
              repoId: message.repoId,
              stocks: message.stocks,
            });
            break;

          case 'complete':
            dispatch({
              type: 'UPDATE_REPO_STOCKS',
              repoId: message.repoId,
              stocks: message.stocks,
            });
            dispatch({
              type: 'SET_REPO_STATUS',
              repoId: message.repoId,
              status: 'ready',
            });
            break;

          case 'parse_started':
            dispatch({
              type: 'SET_REPO_STATUS',
              repoId: message.repoId,
              status: 'parsing',
            });
            break;

          case 'parse_stopped':
            // 解析已停止，不需要特殊处理
            break;

          case 'error':
            if (message.repoId) {
              dispatch({
                type: 'SET_REPO_STATUS',
                repoId: message.repoId,
                status: 'error',
                error: message.message,
              });
            }
            console.error('[WebSocket] Server error:', message.message);
            break;

          case 'diff_detail':
            // 这个消息需要由具体的组件处理，暂时只打印日志
            console.log('[WebSocket] Diff detail received for', message.filePath);
            break;
        }
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      setIsConnected(false);
      dispatch({ type: 'SET_WS_CONNECTED', connected: false });
      wsRef.current = null;

      // 自动重连
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        console.log(`[WebSocket] Reconnecting in ${RECONNECT_DELAY}ms (attempt ${reconnectAttemptsRef.current})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectRef.current();
        }, RECONNECT_DELAY);
      }
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    wsRef.current = ws;
  }, [dispatch]);

  // 更新 ref
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // 阻止自动重连
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendStartParse = useCallback((repoPath: string, repoName: string, maxCommits?: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: StartParseMessage = {
        type: 'start_parse',
        repoPath,
        repoName,
        maxCommits,
      };
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('[WebSocket] Not connected');
    }
  }, []);

  const sendStopParse = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_parse' }));
    }
  }, []);

  const sendRequestDiff = useCallback((repoPath: string, commitHash: string, filePath: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: RequestDiffDetail = {
        type: 'request_diff',
        repoPath,
        commitHash,
        filePath,
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // 连接和断开
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connect,
    disconnect,
    sendStartParse,
    sendStopParse,
    sendRequestDiff,
    isConnected,
  };
}
