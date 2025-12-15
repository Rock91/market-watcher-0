import { WebSocket } from "ws";

// WebSocket message types
export interface SubscribeMessage {
  type: 'subscribe';
  symbols: string[];
}

export interface PriceUpdateMessage {
  type: 'price_update';
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

export interface MarketMoversUpdateMessage {
  type: 'market_movers_update';
  gainers: MarketMover[];
  losers: MarketMover[];
  timestamp: number;
}

export interface MarketMover {
  symbol: string;
  name: string;
  price: number;
  change: string;
  changePercent: number;
}

export type WebSocketMessage = SubscribeMessage | PriceUpdateMessage | MarketMoversUpdateMessage;

// Extended WebSocket interface with symbols property
export interface ExtendedWebSocket extends WebSocket {
  symbols?: string[];
}