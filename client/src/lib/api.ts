// API utilities for Yahoo Finance integration
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number; // Absolute change amount (e.g., 2.50 for +$2.50)
  changePercent: number; // Percentage change (e.g., 2.5 for +2.5%)
  changeFormatted?: string; // Formatted string for display (e.g., "+2.5%")
  vol: string;
  volume?: number;
  currency?: string;
  previousClose?: number;
}

export interface HistoricalData {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartDataPoint {
  time: string;
  price: number;
}

// Get API base URL - uses PORT from environment (injected via Vite)
export const getApiBaseUrl = (): string => {
  // Get port from Vite env (injected from server PORT env var)
  const apiPort = import.meta.env.VITE_API_PORT || '3000';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${hostname}:${apiPort}`;
};

// Fetch stock quote
export const fetchStockQuote = async (symbol: string) => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/stocks/${symbol}/quote`);
  if (!response.ok) throw new Error('Failed to fetch stock quote');
  return response.json();
};

// Fetch historical data
// Note: yahoo-finance2 only supports daily ('1d'), weekly ('1wk'), monthly ('1mo') intervals
export const fetchHistoricalData = async (symbol: string, days: number = 30) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const apiUrl = getApiBaseUrl();

  const response = await fetch(
    `${apiUrl}/api/stocks/${symbol}/history?period1=${startDate.toISOString()}&period2=${endDate.toISOString()}&interval=1d`
  );
  if (!response.ok) throw new Error('Failed to fetch historical data');
  const data = await response.json();

  console.log(`[API] Raw historical data for ${symbol}:`, data?.slice(0, 2));

  // Server already returns formatted data with 'time' and 'price' fields
  // Map to ensure we have the expected format for the chart
  return data.map((item: any) => ({
    time: item.time || new Date(item.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    }),
    price: item.price || item.close || 0
  }));
};

// Fetch intraday data by hours (for real-time chart)
export const fetchIntradayData = async (symbol: string, hours: number = 2, limit: number = 1000) => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(
    `${apiUrl}/api/stocks/${symbol}/history-clickhouse?hours=${hours}&limit=${limit}`
  );
  if (!response.ok) throw new Error('Failed to fetch intraday data');
  const data = await response.json();

  // Format data for chart - convert timestamp to time string
  return data.map((item: any) => {
    const timestamp = new Date(item.timestamp);
    return {
      time: timestamp.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
      price: item.price || 0,
      date: item.timestamp,
      timestamp: item.timestamp,
      volume: item.volume || 0,
      change: item.change || 0,
      changePercent: item.change_percent || 0
    };
  });
};

// Fetch market movers
export const fetchMarketMovers = async (type: 'gainers' | 'losers', count: number = 20): Promise<StockQuote[]> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/market/movers/${type}?count=${count}`);
  if (!response.ok) throw new Error('Failed to fetch market movers');
  return response.json();
};

// Fetch trending symbols
export const fetchTrendingSymbols = async (count: number = 10) => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/market/trending?count=${count}`);
  if (!response.ok) throw new Error('Failed to fetch trending symbols');
  return response.json();
};

// Fetch market summary
export const fetchMarketSummary = async () => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/market/summary`);
  if (!response.ok) throw new Error('Failed to fetch market summary');
  return response.json();
};

// AI Signal generation
export interface AISignalRequest {
  symbol: string;
  price: number;
  volume: number;
  historicalPrices: number[];
  strategy: string;
  sentimentScore: number;
}

export interface AISignalResponse {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
}

export const fetchAISignal = async (data: AISignalRequest): Promise<AISignalResponse> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/ai/signal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error('Failed to generate AI signal');
  return response.json();
};

// Technical Indicators
export interface TechnicalIndicatorsResponse {
  symbol: string;
  indicators: {
    rsi: {
      value: number;
      level: 'Oversold' | 'Neutral' | 'Overbought';
      interpretation: string;
    };
    macd: {
      value: number;
      signal: number;
      histogram: number;
      interpretation: string;
    };
    volatility: {
      value: number;
      level: 'Low' | 'Medium' | 'High';
      interpretation: string;
    };
  };
  dataPoints: number;
  lastUpdated: string;
}

export const fetchTechnicalIndicators = async (symbol: string, days: number = 30): Promise<TechnicalIndicatorsResponse> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/stocks/${symbol}/indicators?days=${days}`);
  if (!response.ok) throw new Error('Failed to fetch technical indicators');
  return response.json();
};

// Market Status
export interface MarketStatus {
  isOpen: boolean;
  nextOpen?: string;
  nextClose?: string;
  message: string;
}

export const fetchMarketStatus = async (): Promise<MarketStatus> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/market/status`);
  if (!response.ok) throw new Error('Failed to fetch market status');
  return response.json();
};

// Trade Management
export interface TradeRequest {
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity?: number;
  amount: number;
  confidence: number;
  strategy?: string;
  reason?: string;
  signalId?: string;
}

export interface TradeResponse {
  tradeId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  amount: number;
  profit?: number;
  time: string;
  status: string;
  confidence?: number;
  strategy?: string;
}

export const storeTrade = async (trade: TradeRequest): Promise<TradeResponse> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/trades`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(trade)
  });
  if (!response.ok) throw new Error('Failed to store trade');
  return response.json();
};

export const fetchTrades = async (symbol?: string, status?: string, limit: number = 50): Promise<TradeResponse[]> => {
  const apiUrl = getApiBaseUrl();
  const params = new URLSearchParams();
  if (symbol) params.append('symbol', symbol);
  if (status) params.append('status', status);
  params.append('limit', limit.toString());
  
  const response = await fetch(`${apiUrl}/api/trades?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch trades');
  return response.json();
};

export const fetchRecentTrades = async (limit: number = 50): Promise<TradeResponse[]> => {
  const apiUrl = getApiBaseUrl();
  const response = await fetch(`${apiUrl}/api/trades/recent?limit=${limit}`);
  if (!response.ok) throw new Error('Failed to fetch recent trades');
  return response.json();
};