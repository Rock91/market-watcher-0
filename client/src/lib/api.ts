// API utilities for Yahoo Finance integration
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: string;
  vol: string;
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

// Fetch stock quote
export const fetchStockQuote = async (symbol: string) => {
  const response = await fetch(`/api/stocks/${symbol}/quote`);
  if (!response.ok) throw new Error('Failed to fetch stock quote');
  return response.json();
};

// Fetch historical data
export const fetchHistoricalData = async (symbol: string, days: number = 30) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const response = await fetch(
    `/api/stocks/${symbol}/history?period1=${startDate.toISOString()}&period2=${endDate.toISOString()}&interval=5m`
  );
  if (!response.ok) throw new Error('Failed to fetch historical data');
  const data = await response.json();

  // Convert to chart format
  return data.map((item: any) => ({
    time: new Date(item.date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false
    }),
    price: item.close
  }));
};

// Fetch market movers
export const fetchMarketMovers = async (type: 'gainers' | 'losers', count: number = 20): Promise<StockQuote[]> => {
  const response = await fetch(`/api/market/movers/${type}?count=${count}`);
  if (!response.ok) throw new Error('Failed to fetch market movers');
  return response.json();
};

// Fetch trending symbols
export const fetchTrendingSymbols = async (count: number = 10) => {
  const response = await fetch(`/api/market/trending?count=${count}`);
  if (!response.ok) throw new Error('Failed to fetch trending symbols');
  return response.json();
};

// Fetch market summary
export const fetchMarketSummary = async () => {
  const response = await fetch('/api/market/summary');
  if (!response.ok) throw new Error('Failed to fetch market summary');
  return response.json();
};