import { useEffect, useRef, useState, useCallback } from 'react';
import { getApiBaseUrl } from '../lib/api';

// WebSocket Event Types
export type WebSocketEventType = 
  | 'subscribe'
  | 'unsubscribe'
  | 'price_update'
  | 'market_movers_update'
  | 'trending_update'
  | 'ai_signal'
  | 'historical_update'
  | 'connection_status'
  | 'error';

// Price Update
export interface PriceUpdate {
  type: 'price_update';
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  dayHigh?: number;
  dayLow?: number;
  timestamp: number;
}

// Market Mover
export interface MarketMover {
  symbol: string;
  name: string;
  price: number;
  change: string;
  changePercent: number;
  volume?: string;
  currency?: string;
}

// Market Movers Update
export interface MarketMoversUpdate {
  type: 'market_movers_update';
  gainers: MarketMover[];
  losers: MarketMover[];
  timestamp: number;
}

// Trending Symbol
export interface TrendingSymbol {
  symbol: string;
  name: string;
  rank: number;
  price?: number;
  changePercent?: number;
}

// Trending Update
export interface TrendingUpdate {
  type: 'trending_update';
  symbols: TrendingSymbol[];
  timestamp: number;
}

// AI Signal
export interface AISignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  strategy: string;
  indicators: {
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    sma20?: number;
    sma50?: number;
    volatility?: number;
  };
  priceTarget?: {
    entry: number;
    stopLoss: number;
    takeProfit: number;
  };
}

// AI Signal Update
export interface AISignalUpdate {
  type: 'ai_signal';
  signal: AISignal;
  timestamp: number;
}

// Historical Data Point
export interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Historical Update
export interface HistoricalUpdate {
  type: 'historical_update';
  symbol: string;
  data: HistoricalDataPoint[];
  interval: string;
  timestamp: number;
}

// Connection Status
export interface ConnectionStatus {
  type: 'connection_status';
  status: 'connected' | 'disconnected' | 'reconnecting';
  clientId: string;
  subscribedSymbols: string[];
  subscribedEvents: WebSocketEventType[];
  timestamp: number;
}

// Error Message
export interface WebSocketError {
  type: 'error';
  code: string;
  message: string;
  timestamp: number;
}

// All WebSocket Messages
export type WebSocketMessage = 
  | PriceUpdate 
  | MarketMoversUpdate 
  | TrendingUpdate 
  | AISignalUpdate 
  | HistoricalUpdate 
  | ConnectionStatus 
  | WebSocketError;

// Hook Options
export interface UseWebSocketOptions {
  symbols?: string[];
  events?: WebSocketEventType[];
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

// Hook Return Type
export interface UseWebSocketReturn {
  isConnected: boolean;
  connectionStatus: ConnectionStatus | null;
  priceUpdates: Map<string, PriceUpdate>;
  marketMovers: { gainers: MarketMover[], losers: MarketMover[] } | null;
  trendingSymbols: TrendingSymbol[];
  aiSignals: Map<string, AISignal>;
  latestAISignal: AISignal | null;
  historicalData: Map<string, HistoricalDataPoint[]>;
  errors: WebSocketError[];
  error: string | null;
  subscribe: (symbols: string[], events?: WebSocketEventType[]) => void;
  unsubscribe: (symbols?: string[], events?: WebSocketEventType[]) => void;
  requestAISignal: (symbol: string, strategy?: string) => void;
  requestHistorical: (symbol: string, days?: number) => void;
  disconnect: () => void;
  reconnect: () => void;
}

export const useWebSocket = (
  urlOrOptions?: string | UseWebSocketOptions,
  symbolsParam: string[] = []
): UseWebSocketReturn => {
  // Parse options
  const options: UseWebSocketOptions = typeof urlOrOptions === 'string' 
    ? { symbols: symbolsParam }
    : urlOrOptions || {};

  const symbols = options.symbols || symbolsParam;
  const events = options.events || ['price_update', 'market_movers_update', 'ai_signal', 'trending_update'];
  const autoConnect = options.autoConnect !== false;
  const maxReconnectAttempts = options.reconnectAttempts || 5;
  const baseReconnectDelay = options.reconnectDelay || 2000;

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [priceUpdates, setPriceUpdates] = useState<Map<string, PriceUpdate>>(new Map());
  const [marketMovers, setMarketMovers] = useState<{ gainers: MarketMover[], losers: MarketMover[] } | null>(null);
  const [trendingSymbols, setTrendingSymbols] = useState<TrendingSymbol[]>([]);
  const [aiSignals, setAiSignals] = useState<Map<string, AISignal>>(new Map());
  const [latestAISignal, setLatestAISignal] = useState<AISignal | null>(null);
  const [historicalData, setHistoricalData] = useState<Map<string, HistoricalDataPoint[]>>(new Map());
  const [errors, setErrors] = useState<WebSocketError[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const subscribedSymbols = useRef<string[]>([]);
  const subscribedEvents = useRef<WebSocketEventType[]>([]);
  const isConnecting = useRef(false);
  const isMounted = useRef(true);

  // Build WebSocket URL
  const getWsUrl = useCallback(() => {
    if (typeof urlOrOptions === 'string') {
      return urlOrOptions;
    }
    
    // Build URL from API base
    const apiBase = getApiBaseUrl();
    const protocol = apiBase.startsWith('https') ? 'wss:' : 'ws:';
    const host = apiBase.replace(/^https?:\/\//, '');
    return `${protocol}//${host}`;
  }, [urlOrOptions]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting.current || (ws.current && ws.current.readyState === WebSocket.OPEN)) {
      console.log('[WebSocket] Already connected or connecting, skipping');
      return;
    }

    // Clean up any existing connection
    if (ws.current) {
      ws.current.onclose = null;
      ws.current.onerror = null;
      ws.current.onmessage = null;
      ws.current.onopen = null;
      if (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING) {
        ws.current.close(1000);
      }
      ws.current = null;
    }

    isConnecting.current = true;

    try {
      const wsUrl = getWsUrl();
      console.log('[WebSocket] Connecting to:', wsUrl);
      
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        if (!isMounted.current) return;
        console.log('[WebSocket] Connected');
        isConnecting.current = false;
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;

        // Subscribe to symbols and events
        if (symbols.length > 0 || events.length > 0) {
          setTimeout(() => {
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              const message = {
                type: 'subscribe',
                symbols: symbols,
                events: events
              };
              ws.current.send(JSON.stringify(message));
              console.log('[WebSocket] Subscribed:', message);
            }
          }, 100);
        }
      };

      ws.current.onmessage = (event) => {
        if (!isMounted.current) return;
        try {
          const data = JSON.parse(event.data) as WebSocketMessage;
          handleMessage(data);
        } catch (err) {
          console.error('[WebSocket] Error parsing message:', err);
        }
      };

      ws.current.onclose = (event) => {
        if (!isMounted.current) return;
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        isConnecting.current = false;
        setIsConnected(false);
        setConnectionStatus(prev => prev ? { ...prev, status: 'disconnected' } : null);

        // Attempt reconnect if not intentional and component is still mounted
        if (event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts && isMounted.current) {
          reconnectAttempts.current++;
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current - 1);
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
          
          setConnectionStatus(prev => prev ? { ...prev, status: 'reconnecting' } : null);
          
          reconnectTimeout.current = setTimeout(() => {
            if (isMounted.current) {
              connect();
            }
          }, delay);
        }
      };

      ws.current.onerror = (error) => {
        if (!isMounted.current) return;
        console.error('[WebSocket] Error:', error);
        isConnecting.current = false;
        setError('WebSocket connection error');
      };

    } catch (err) {
      console.error('[WebSocket] Failed to connect:', err);
      isConnecting.current = false;
      setError('Failed to create WebSocket connection');
    }
  }, [getWsUrl, symbols, events, maxReconnectAttempts, baseReconnectDelay, handleMessage]);

  // Handle incoming messages
  const handleMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case 'price_update':
        setPriceUpdates(prev => {
          const newMap = new Map(prev);
          newMap.set(data.symbol, data);
          return newMap;
        });
        break;

      case 'market_movers_update':
        setMarketMovers({
          gainers: data.gainers,
          losers: data.losers
        });
        break;

      case 'trending_update':
        setTrendingSymbols(data.symbols);
        break;

      case 'ai_signal':
        setAiSignals(prev => {
          const newMap = new Map(prev);
          newMap.set(data.signal.symbol, data.signal);
          return newMap;
        });
        setLatestAISignal(data.signal);
        break;

      case 'historical_update':
        setHistoricalData(prev => {
          const newMap = new Map(prev);
          newMap.set(data.symbol, data.data);
          return newMap;
        });
        break;

      case 'connection_status':
        setConnectionStatus(data);
        subscribedSymbols.current = data.subscribedSymbols;
        subscribedEvents.current = data.subscribedEvents;
        break;

      case 'error':
        setErrors(prev => [...prev.slice(-9), data]);
        setError(data.message);
        break;
    }
  }, []);

  // Subscribe to symbols and events
  const subscribe = useCallback((newSymbols: string[], newEvents?: WebSocketEventType[]) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'subscribe',
        symbols: newSymbols,
        events: newEvents || events
      };
      ws.current.send(JSON.stringify(message));
      console.log('[WebSocket] Subscribed:', message);
    }
  }, [events]);

  // Unsubscribe from symbols and events
  const unsubscribe = useCallback((symbols?: string[], events?: WebSocketEventType[]) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'unsubscribe',
        symbols,
        events
      };
      ws.current.send(JSON.stringify(message));
      console.log('[WebSocket] Unsubscribed:', message);
    }
  }, []);

  // Request AI signal for a symbol
  const requestAISignal = useCallback((symbol: string, strategy?: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'request_ai_signal',
        symbol,
        strategy
      };
      ws.current.send(JSON.stringify(message));
      console.log('[WebSocket] Requested AI signal:', symbol, strategy);
    }
  }, []);

  // Request historical data for a symbol
  const requestHistorical = useCallback((symbol: string, days?: number) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'request_historical',
        symbol,
        days
      };
      ws.current.send(JSON.stringify(message));
      console.log('[WebSocket] Requested historical data:', symbol, days);
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    if (ws.current) {
      ws.current.onclose = null; // Prevent reconnect attempts
      ws.current.close(1000, 'Client disconnecting');
      ws.current = null;
    }
    isConnecting.current = false;
    setIsConnected(false);
    subscribedSymbols.current = [];
    subscribedEvents.current = [];
  }, []);

  // Reconnect
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttempts.current = 0;
    setTimeout(connect, 100);
  }, [disconnect, connect]);

  // Auto-connect on mount (run only once)
  useEffect(() => {
    isMounted.current = true;
    
    if (autoConnect) {
      // Small delay to avoid React Strict Mode double-mount issues
      const connectTimer = setTimeout(() => {
        if (isMounted.current) {
          connect();
        }
      }, 100);

      return () => {
        clearTimeout(connectTimer);
        isMounted.current = false;
        
        // Clean up reconnect timeout
        if (reconnectTimeout.current) {
          clearTimeout(reconnectTimeout.current);
          reconnectTimeout.current = null;
        }
        
        // Close WebSocket
        if (ws.current) {
          ws.current.onclose = null; // Prevent reconnect on cleanup
          ws.current.close(1000, 'Component unmounting');
          ws.current = null;
        }
        
        isConnecting.current = false;
      };
    }

    return () => {
      isMounted.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount/unmount

  // Update subscriptions when symbols change
  useEffect(() => {
    if (isConnected && symbols.length > 0) {
      const newSymbols = symbols.filter(s => !subscribedSymbols.current.includes(s));
      if (newSymbols.length > 0) {
        subscribe(symbols);
      }
    }
  }, [symbols, isConnected, subscribe]);

  return {
    isConnected,
    connectionStatus,
    priceUpdates,
    marketMovers,
    trendingSymbols,
    aiSignals,
    latestAISignal,
    historicalData,
    errors,
    error,
    subscribe,
    unsubscribe,
    requestAISignal,
    requestHistorical,
    disconnect,
    reconnect
  };
};
