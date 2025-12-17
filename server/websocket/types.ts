import { WebSocket } from "ws";

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

// Client -> Server Messages
export interface SubscribeMessage {
  type: 'subscribe';
  symbols: string[];
  events?: WebSocketEventType[]; // Which events to subscribe to
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  symbols?: string[];
  events?: WebSocketEventType[];
}

export interface RequestAISignalMessage {
  type: 'request_ai_signal';
  symbol: string;
  strategy?: string;
}

export interface RequestHistoricalMessage {
  type: 'request_historical';
  symbol: string;
  days?: number;
}

// Server -> Client Messages
export interface PriceUpdateMessage {
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

export interface MarketMover {
  symbol: string;
  name: string;
  price: number;
  change: string;
  changePercent: number;
  volume?: string;
  currency?: string;
}

export interface MarketMoversUpdateMessage {
  type: 'market_movers_update';
  gainers: MarketMover[];
  losers: MarketMover[];
  timestamp: number;
}

export interface TrendingSymbol {
  symbol: string;
  name: string;
  rank: number;
  price?: number;
  changePercent?: number;
}

export interface TrendingUpdateMessage {
  type: 'trending_update';
  symbols: TrendingSymbol[];
  timestamp: number;
}

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

export interface AISignalMessage {
  type: 'ai_signal';
  signal: AISignal;
  timestamp: number;
}

export interface HistoricalDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalUpdateMessage {
  type: 'historical_update';
  symbol: string;
  data: HistoricalDataPoint[];
  interval: string;
  timestamp: number;
}

export interface ConnectionStatusMessage {
  type: 'connection_status';
  status: 'connected' | 'disconnected' | 'reconnecting';
  clientId: string;
  subscribedSymbols: string[];
  subscribedEvents: WebSocketEventType[];
  timestamp: number;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  timestamp: number;
}

// Union type for all messages
export type ClientToServerMessage = 
  | SubscribeMessage 
  | UnsubscribeMessage 
  | RequestAISignalMessage 
  | RequestHistoricalMessage;

export type ServerToClientMessage = 
  | PriceUpdateMessage 
  | MarketMoversUpdateMessage 
  | TrendingUpdateMessage
  | AISignalMessage
  | HistoricalUpdateMessage
  | ConnectionStatusMessage
  | ErrorMessage;

export type WebSocketMessage = ClientToServerMessage | ServerToClientMessage;

// Extended WebSocket interface with client state
export interface ExtendedWebSocket extends WebSocket {
  clientId?: string;
  symbols?: string[];
  subscribedEvents?: WebSocketEventType[];
  lastActivity?: number;
}
