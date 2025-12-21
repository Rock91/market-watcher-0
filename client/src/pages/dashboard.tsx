import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  Zap,
  AlertTriangle,
  Cpu,
  BarChart3,
  Search,
  ShieldCheck,
  BrainCircuit,
  RefreshCw
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { fetchStockQuote, fetchHistoricalData, fetchIntradayData, fetchMarketMovers, fetchTrendingSymbols, fetchAISignal, fetchTechnicalIndicators, fetchMarketStatus, storeTrade, fetchRecentTrades, type StockQuote, type TechnicalIndicatorsResponse, type MarketStatus, type TradeResponse } from "@/lib/api";
import { useWebSocket, type PriceUpdate, type MarketMover, type AISignal, type TrendingSymbol } from "@/hooks/use-websocket";

// Mock Data Generators
const generateStockData = (basePrice: number) => {
  const data = [];
  let price = basePrice;
  for (let i = 0; i < 20; i++) {
    price = price * (1 + (Math.random() * 0.04 - 0.02));
    data.push({
      time: `${9 + Math.floor(i/2)}:${i % 2 === 0 ? '00' : '30'}`,
      price: price
    });
  }
  return data;
};

// Mock Gainers/Losers
const TOP_GAINERS = [
  { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M", currency: "USD" },
  { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M", currency: "USD" },
  { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M", currency: "USD" },
  { symbol: "COIN", name: "Coinbase Global", price: 265.12, change: "+6.5%", vol: "12M", currency: "USD" },
  { symbol: "TSLA", name: "Tesla Inc", price: 180.45, change: "+5.9%", vol: "35M", currency: "USD" },
  { symbol: "MARA", name: "Marathon Digital", price: 22.30, change: "+5.4%", vol: "8M", currency: "USD" },
  { symbol: "MSTR", name: "MicroStrategy", price: 1650.00, change: "+4.8%", vol: "1.2M", currency: "USD" },
  { symbol: "RIOT", name: "Riot Platforms", price: 12.45, change: "+4.2%", vol: "5M", currency: "USD" },
  { symbol: "HOOD", name: "Robinhood", price: 19.80, change: "+3.9%", vol: "6M", currency: "USD" },
  { symbol: "DKNG", name: "DraftKings", price: 44.20, change: "+3.5%", vol: "4M", currency: "USD" },
  { symbol: "ARM", name: "Arm Holdings", price: 132.50, change: "+3.2%", vol: "3M", currency: "USD" },
  { symbol: "SMCI", name: "Super Micro", price: 890.10, change: "+2.9%", vol: "2M", currency: "USD" },
  { symbol: "META", name: "Meta Platforms", price: 485.60, change: "+2.5%", vol: "15M" },
  { symbol: "NET", name: "Cloudflare", price: 92.40, change: "+2.2%", vol: "5M" },
  { symbol: "UBER", name: "Uber Tech", price: 78.90, change: "+2.0%", vol: "9M" },
  { symbol: "ABNB", name: "Airbnb Inc", price: 145.20, change: "+1.8%", vol: "4M" },
  { symbol: "DASH", name: "DoorDash", price: 112.30, change: "+1.5%", vol: "3M" },
  { symbol: "SHOP", name: "Shopify Inc", price: 76.50, change: "+1.4%", vol: "6M" },
  { symbol: "SQ", name: "Block Inc", price: 72.80, change: "+1.2%", vol: "5M" },
  { symbol: "SOFI", name: "SoFi Tech", price: 7.85, change: "+1.0%", vol: "10M" },
];

const TOP_LOSERS = [
  { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M", currency: "USD" },
  { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M", currency: "USD" },
  { symbol: "LULU", name: "Lululemon", price: 290.50, change: "-6.8%", vol: "5M", currency: "USD" },
  { symbol: "NKE", name: "Nike Inc", price: 92.30, change: "-5.5%", vol: "12M", currency: "USD" },
  { symbol: "BA", name: "Boeing Co", price: 175.60, change: "-4.9%", vol: "8M", currency: "USD" },
  { symbol: "T", name: "AT&T Inc", price: 16.20, change: "-3.8%", vol: "25M", currency: "USD" },
  { symbol: "VZ", name: "Verizon", price: 38.90, change: "-3.2%", vol: "20M", currency: "USD" },
  { symbol: "DIS", name: "Disney", price: 110.40, change: "-2.9%", vol: "15M", currency: "USD" },
  { symbol: "PFE", name: "Pfizer", price: 26.80, change: "-2.5%", vol: "18M", currency: "USD" },
  { symbol: "XOM", name: "Exxon Mobil", price: 115.20, change: "-2.1%", vol: "14M", currency: "USD" },
  { symbol: "JNJ", name: "Johnson & Johnson", price: 145.60, change: "-1.9%", vol: "8M", currency: "USD" },
  { symbol: "KO", name: "Coca-Cola", price: 58.90, change: "-1.8%", vol: "10M", currency: "USD" },
  { symbol: "PEP", name: "PepsiCo", price: 165.40, change: "-1.7%", vol: "5M", currency: "USD" },
  { symbol: "MCD", name: "McDonald's", price: 278.50, change: "-1.5%", vol: "4M", currency: "USD" },
  { symbol: "SBUX", name: "Starbucks", price: 85.20, change: "-1.4%", vol: "6M", currency: "USD" },
  { symbol: "WMT", name: "Walmart", price: 59.80, change: "-1.2%", vol: "12M", currency: "USD" },
  { symbol: "TGT", name: "Target", price: 135.60, change: "-1.1%", vol: "5M", currency: "USD" },
  { symbol: "COST", name: "Costco", price: 745.20, change: "-1.0%", vol: "3M", currency: "USD" },
  { symbol: "PG", name: "Procter & Gamble", price: 158.40, change: "-0.9%", vol: "4M", currency: "USD" },
  { symbol: "CVX", name: "Chevron", price: 148.90, change: "-0.8%", vol: "7M", currency: "USD" },
];

interface PredictionLog {
  id: number;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  time: string;
  reason: string;
  simulatedProfit: number; // Potential profit on $10
}

interface Transaction {
  id: number;
  symbol: string;
  action: "BUY" | "SELL";
  amount: number;
  profit: number;
  time: string;
}

interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: string | number;
  vol: string;
  currency?: string;
  changePercent?: number;
}

// Helper function to check if change is positive
function isPositiveChange(change: string | number | undefined): boolean {
  if (change === undefined) return false;
  if (typeof change === 'string') {
    return change.startsWith('+') || (!change.startsWith('-') && parseFloat(change) > 0);
  }
  return change > 0;
}

// Format change amount with currency
function formatChangeAmount(change: number, currency: string = 'USD'): string {
  const sign = change >= 0 ? '+' : '';
  const symbol = currency === 'USD' ? '$' : currency + ' ';
  return `${sign}${symbol}${Math.abs(change).toFixed(2)}`;
}

// Format percentage change
function formatChangePercent(changePercent: number): string {
  const sign = changePercent >= 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
}

export default function Dashboard() {
  const [logs, setLogs] = useState<PredictionLog[]>([]);
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [balance, setBalance] = useState(100);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [aiStrategy, setAiStrategy] = useState("neuro-scalp");
  const [topGainers, setTopGainers] = useState<StockQuote[]>([]);
  const [topLosers, setTopLosers] = useState<StockQuote[]>([]);
  const [trendingStocks, setTrendingStocks] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [indicators, setIndicators] = useState<TechnicalIndicatorsResponse | null>(null);
  const [indicatorsLoading, setIndicatorsLoading] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [chartHours, setChartHours] = useState(2); // Default: last 2 hours (or 24 if market closed)
  const [isRealTimeMode, setIsRealTimeMode] = useState(true); // Default: LIVE mode
  const [userManuallySetHours, setUserManuallySetHours] = useState(false); // Track if user manually changed hours
  const lastChartUpdateRef = useRef<number>(0); // Track last chart update timestamp
  const chartUpdateThrottleMs = 5000; // Update chart at most every 5 seconds (matching server frequency)

  // Debug: Log chartHours changes
  useEffect(() => {
    console.log(`[Chart] chartHours changed to: ${chartHours}, userManuallySetHours: ${userManuallySetHours}`);
  }, [chartHours, userManuallySetHours]);

  // WebSocket connection for real-time updates with all event types
  const { 
    isConnected, 
    priceUpdates, 
    marketMovers, 
    trendingSymbols,
    aiSignals,
    latestAISignal,
    requestAISignal,
    subscribe,
    error: wsError 
  } = useWebSocket({
    symbols: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'NFLX', 'GOOG'],
    events: ['price_update', 'market_movers_update', 'ai_signal', 'trending_update'],
    autoConnect: true
  });

  // Subscribe to selected stock for real-time updates
  useEffect(() => {
    if (selectedStock && isConnected && subscribe && marketStatus?.isOpen) {
      subscribe([selectedStock.symbol], ['price_update']);
      console.log(`[Dashboard] Subscribed to real-time updates for ${selectedStock.symbol}`);
    }
  }, [selectedStock, isConnected, marketStatus?.isOpen, subscribe]);

  // Use ref to keep track of current balance inside interval closure
  const balanceRef = useRef(balance);
  const aiStrategyRef = useRef(aiStrategy);

  // Sync ref with state
  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    aiStrategyRef.current = aiStrategy;
  }, [aiStrategy]);

  // Load initial market data - call all APIs on load
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('[Dashboard] Loading all market data on page load...');

        // Popular stocks to pre-fetch
        const popularSymbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'NFLX'];

        // Call main APIs in parallel
        const [gainers, losers, trending, status] = await Promise.all([
          fetchMarketMovers('gainers', 20),
          fetchMarketMovers('losers', 20),
          fetchTrendingSymbols(20),
          fetchMarketStatus()
        ]);

        setMarketStatus(status);

        // Pre-fetch quotes for popular stocks (non-blocking, don't wait for all)
        const popularQuotesPromises = popularSymbols.map(symbol => 
          fetchStockQuote(symbol).catch(err => {
            console.warn(`Failed to fetch quote for ${symbol}:`, err);
            return null;
          })
        );
        
        // Wait for popular quotes (but don't block if some fail)
        const popularQuotes = await Promise.all(popularQuotesPromises);

        console.log('[Dashboard] Market data loaded:', {
          gainers: gainers.length,
          losers: losers.length,
          trending: trending.symbols?.length || 0,
          popularQuotes: popularQuotes.filter(q => q !== null).length
        });

        // Debug: Log first few items from each array
        console.log('[Dashboard] Sample gainers:', gainers.slice(0, 3));
        console.log('[Dashboard] Sample losers:', losers.slice(0, 3));

        setTopGainers(gainers);
        setTopLosers(losers);

        // Convert trending symbols to StockQuote format
        if (trending && trending.symbols && trending.symbols.length > 0) {
          console.log('[Dashboard] Converting trending symbols to quotes...');
          const convertTrendingToStockQuotes = async () => {
            // Extract symbol strings - handle both string arrays and object arrays
            const symbolStrings = trending.symbols.map((item: any) => {
              if (typeof item === 'string') {
                return item;
              } else if (item && typeof item === 'object' && item.symbol) {
                return item.symbol;
              } else if (item && typeof item === 'object' && item.name) {
                return item.name;
              }
              return String(item); // Fallback to string conversion
            }).filter((s: string) => s && s !== '[object Object]'); // Filter out invalid symbols
            
            const quotes = await Promise.all(
              symbolStrings.map(async (symbol: string) => {
                try {
                  // Ensure symbol is a string
                  const symbolStr = String(symbol).trim();
                  if (!symbolStr || symbolStr === '[object Object]') {
                    console.warn(`[Dashboard] Invalid symbol: ${symbol}`);
                    return null;
                  }
                  const quote = await fetchStockQuote(symbolStr);
                  return {
                    ...quote,
                    changeFormatted: formatChangePercent(quote.changePercent || 0),
                    vol: quote.vol || `${(quote.volume || 0).toLocaleString()}`
                  } as StockQuote;
                } catch (err) {
                  console.warn(`Failed to fetch quote for trending symbol ${symbol}:`, err);
                  // Fallback if quote fetch fails
                  return {
                    symbol: String(symbol),
                    name: String(symbol),
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    changeFormatted: '0%',
                    vol: '0',
                    currency: 'USD'
                  } as StockQuote;
                }
              })
            );
            setTrendingStocks(quotes.filter(q => q !== null) as StockQuote[]);
            console.log(`[Dashboard] Loaded ${quotes.filter(q => q !== null).length} trending stock quotes`);
          };
          convertTrendingToStockQuotes();
        } else {
          setTrendingStocks([]);
        }

        // Set initial selected stock
        if (gainers.length > 0) {
          setSelectedStock(gainers[0]);
        }

        // Log popular stock quotes for debugging
        const successfulQuotes = popularQuotes.filter(q => q !== null);
        if (successfulQuotes.length > 0) {
          console.log('[Dashboard] Pre-fetched quotes:', successfulQuotes.map((q: any) => `${q.symbol}: $${q.price?.toFixed(2)}`).join(', '));
        }

        // Load recent trades from database (only once)
        try {
          const dbTrades = await fetchRecentTrades(50);
          if (dbTrades && dbTrades.length > 0) {
            // Convert database trades to Transaction format
            const dbTransactions: Transaction[] = dbTrades.map(trade => ({
              id: parseInt(trade.tradeId.replace(/-/g, '').substring(0, 13)) || Date.now(),
              symbol: trade.symbol,
              action: trade.action,
              amount: trade.amount,
              profit: trade.profit || 0,
              time: new Date(trade.time).toLocaleTimeString()
            }));
            setTransactions(prev => {
              // Merge with existing transactions, avoiding duplicates
              const merged = [...dbTransactions, ...prev];
              const unique = merged.filter((tx, index, self) => 
                index === self.findIndex(t => t.id === tx.id && t.symbol === tx.symbol && t.time === tx.time)
              );
              return unique.slice(0, 50);
            });
            console.log(`[Dashboard] Loaded ${dbTrades.length} trades from database`);
          }
        } catch (error) {
          console.error('Failed to load trades from database:', error);
          // Continue - trades will still work locally
        }

      } catch (err) {
        console.error('Error loading initial data:', err);
        setError('Failed to load market data. Using demo mode.');
        // Fallback to mock data if API fails
        const mockGainers = [
          { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: 18.02, changePercent: 12.4, changeFormatted: "+12.4%", vol: "45M", currency: "USD" },
          { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: 14.67, changePercent: 8.2, changeFormatted: "+8.2%", vol: "22M", currency: "USD" },
          { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: 1.91, changePercent: 7.8, changeFormatted: "+7.8%", vol: "18M", currency: "USD" },
        ];
        const mockLosers = [
          { symbol: "INTC", name: "Intel Corp", price: 30.12, change: -2.53, changePercent: -8.4, changeFormatted: "-8.4%", vol: "30M", currency: "USD" },
          { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: -1.33, changePercent: -7.2, changeFormatted: "-7.2%", vol: "10M", currency: "USD" },
        ];
        setTopGainers(mockGainers);
        setTopLosers(mockLosers);
        if (!selectedStock) {
          setSelectedStock(mockGainers[0]);
        }
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Handle real-time market movers updates from WebSocket
  useEffect(() => {
    if (marketMovers && marketMovers.gainers && marketMovers.losers) {
      console.log('[WebSocket] Market movers update:', marketMovers.gainers.length, 'gainers,', marketMovers.losers.length, 'losers');
      setTopGainers(marketMovers.gainers.map(mover => {
        const changePercent = typeof mover.changePercent === 'number' ? mover.changePercent : parseFloat(mover.change?.toString().replace('%', '') || '0');
        const change = typeof mover.change === 'number' ? mover.change : (mover.price * changePercent) / 100;
        return {
          symbol: mover.symbol,
          name: mover.name,
          price: mover.price,
          change: change,
          changePercent: changePercent,
          changeFormatted: formatChangePercent(changePercent),
          vol: mover.volume || 'N/A',
          currency: mover.currency || 'USD'
        };
      }));
      setTopLosers(marketMovers.losers.map(mover => {
        const changePercent = typeof mover.changePercent === 'number' ? mover.changePercent : parseFloat(mover.change?.toString().replace('%', '') || '0');
        const change = typeof mover.change === 'number' ? mover.change : (mover.price * changePercent) / 100;
        return {
          symbol: mover.symbol,
          name: mover.name,
          price: mover.price,
          change: change,
          changePercent: changePercent,
          changeFormatted: formatChangePercent(changePercent),
          vol: mover.volume || 'N/A',
          currency: mover.currency || 'USD'
        };
      }));
    }
  }, [marketMovers]);

  // Handle real-time trending symbols updates from WebSocket
  useEffect(() => {
    if (trendingSymbols && trendingSymbols.length > 0) {
      console.log('[WebSocket] Trending symbols update:', trendingSymbols.length, 'symbols');
      // Convert trending symbols to StockQuote format
      const convertTrendingToStockQuotes = async () => {
        const quotes = await Promise.all(
          trendingSymbols.map(async (trending: TrendingSymbol) => {
            try {
              // Ensure symbol is a string, not an object
              const symbolStr = typeof trending === 'string' 
                ? trending 
                : (trending?.symbol ? String(trending.symbol) : String(trending));
              
              if (!symbolStr || symbolStr === '[object Object]') {
                console.warn(`[WebSocket] Invalid trending symbol:`, trending);
                return null;
              }
              
              const quote = await fetchStockQuote(symbolStr);
              return {
                ...quote,
                changeFormatted: formatChangePercent(quote.changePercent || 0),
                vol: quote.vol || `${(quote.volume || 0).toLocaleString()}`
              } as StockQuote;
            } catch (err) {
              console.warn(`Failed to fetch quote for trending symbol:`, err);
              // Fallback if quote fetch fails
              const symbolStr = typeof trending === 'string' 
                ? trending 
                : (trending?.symbol ? String(trending.symbol) : 'UNKNOWN');
              return {
                symbol: symbolStr,
                name: (typeof trending === 'object' && trending?.name) ? String(trending.name) : symbolStr,
                price: 0,
                change: 0,
                changePercent: 0,
                changeFormatted: '0%',
                vol: '0',
                currency: 'USD'
              } as StockQuote;
            }
          })
        );
        setTrendingStocks(quotes.filter(q => q !== null) as StockQuote[]);
      };
      convertTrendingToStockQuotes();
    }
  }, [trendingSymbols]);

  // Handle real-time price updates from WebSocket
  useEffect(() => {
    if (priceUpdates.size > 0) {
      // Update all stocks with latest prices from WebSocket
      // Note: changePercent is already a percentage value (e.g., -11.85 for -11.85%)
      priceUpdates.forEach((update, symbol) => {
        // Calculate absolute change from percentage
        const changePercent = update.changePercent || 0;
        const change = (update.price * changePercent) / 100;
        const changeFormatted = formatChangePercent(changePercent);

        // Update gainers list
        setTopGainers(prev => prev.map(stock =>
          stock.symbol === symbol
            ? {
                ...stock,
                price: update.price,
                change: change,
                changePercent: changePercent,
                changeFormatted: changeFormatted
              }
            : stock
        ));

        // Update losers list
        setTopLosers(prev => prev.map(stock =>
          stock.symbol === symbol
            ? {
                ...stock,
                price: update.price,
                change: change,
                changePercent: changePercent,
                changeFormatted: changeFormatted
              }
            : stock
        ));

        // Update selected stock if it's the one being updated
        if (selectedStock && selectedStock.symbol === symbol) {
          setSelectedStock(prev => prev ? {
            ...prev,
            price: update.price,
            change: change,
            changePercent: changePercent,
            changeFormatted: changeFormatted
          } : null);
          
          // Update chart in real-time if market is open and in real-time mode
          // Use actual timestamp from update, ensure proper time handling
          if (marketStatus?.isOpen && isRealTimeMode) {
            // Parse timestamp correctly - could be number (ms) or string (ISO)
            let updateTimestamp: number;
            if (typeof update.timestamp === 'number') {
              updateTimestamp = update.timestamp;
            } else if (typeof update.timestamp === 'string') {
              updateTimestamp = new Date(update.timestamp).getTime();
            } else {
              updateTimestamp = Date.now();
            }
            
            const updateDate = new Date(updateTimestamp);
            const now = Date.now();
            
            // Throttle: Only update chart if enough time has passed (5 seconds minimum between updates)
            // But use the actual update timestamp, not current time
            if (now - lastChartUpdateRef.current >= chartUpdateThrottleMs) {
              lastChartUpdateRef.current = now;
              
              setChartData(prev => {
                // Check if we already have data for this exact timestamp (within 1 second tolerance)
                const existingIndex = prev.findIndex((d: any) => {
                  let dataTime: number;
                  if (d.timestamp) {
                    dataTime = typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp).getTime();
                  } else if (d.date) {
                    dataTime = new Date(d.date).getTime();
                  } else {
                    return false;
                  }
                  // Check if timestamps are within 1 second (accounting for network delay)
                  return Math.abs(dataTime - updateTimestamp) < 1000;
                });
                
                let newData = [...prev];
                
                // Format time using system timezone
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                let timeStr: string;
                if (chartHours <= 1) {
                  timeStr = updateDate.toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZone: timeZone
                  });
                } else {
                  timeStr = updateDate.toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false,
                    timeZone: timeZone
                  });
                }
                
                // Update existing point or add new one
                if (existingIndex >= 0) {
                  // Update existing data point with latest price
                  newData[existingIndex] = {
                    ...newData[existingIndex],
                    time: timeStr,
                    price: update.price,
                    date: updateDate.toISOString(),
                    timestamp: updateTimestamp,
                    volume: update.volume || newData[existingIndex].volume || 0,
                    change: change,
                    changePercent: changePercent
                  };
                } else {
                  // Only add if this timestamp is newer than the last point (prevent out-of-order data)
                  const lastPoint = newData[newData.length - 1];
                  if (lastPoint) {
                    let lastTime: number;
                    if (lastPoint.timestamp) {
                      lastTime = typeof lastPoint.timestamp === 'number' ? lastPoint.timestamp : new Date(lastPoint.timestamp).getTime();
                    } else if (lastPoint.date) {
                      lastTime = new Date(lastPoint.date).getTime();
                    } else {
                      lastTime = 0;
                    }
                    
                    // Only add if new timestamp is >= last timestamp (allow same second updates)
                    if (updateTimestamp >= lastTime - 1000) {
                      newData.push({
                        time: timeStr,
                        price: update.price,
                        date: updateDate.toISOString(),
                        timestamp: updateTimestamp,
                        volume: update.volume || 0,
                        change: change,
                        changePercent: changePercent
                      });
                    }
                  } else {
                    // No existing data, add this point
                    newData.push({
                      time: timeStr,
                      price: update.price,
                      date: updateDate.toISOString(),
                      timestamp: updateTimestamp,
                      volume: update.volume || 0,
                      change: change,
                      changePercent: changePercent
                    });
                  }
                }
                
                // Sort by timestamp to maintain chronological order
                newData.sort((a: any, b: any) => {
                  let timeA: number, timeB: number;
                  
                  if (a.timestamp) {
                    timeA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
                  } else if (a.date) {
                    timeA = new Date(a.date).getTime();
                  } else {
                    timeA = 0;
                  }
                  
                  if (b.timestamp) {
                    timeB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
                  } else if (b.date) {
                    timeB = new Date(b.date).getTime();
                  } else {
                    timeB = 0;
                  }
                  
                  return timeA - timeB;
                });
                
                // Keep only data within the selected time range (from current time, not update time)
                const currentTime = Date.now();
                const cutoffTime = currentTime - (chartHours * 60 * 60 * 1000);
                return newData.filter((d: any) => {
                  let dataTime: number;
                  if (d.timestamp) {
                    dataTime = typeof d.timestamp === 'number' ? d.timestamp : new Date(d.timestamp).getTime();
                  } else if (d.date) {
                    dataTime = new Date(d.date).getTime();
                  } else {
                    return false;
                  }
                  return dataTime >= cutoffTime;
                });
              });
            }
          }
        }
      });
    }
  }, [priceUpdates, selectedStock, marketStatus?.isOpen, isRealTimeMode, chartHours]);

  // Handle real-time AI signals from WebSocket
  useEffect(() => {
    if (latestAISignal) {
      const signal = latestAISignal;
      
      // Calculate simulated profit based on confidence and action
      let profitPercent = (Math.random() * 7 - 2) / 100;
      if (signal.action === "SELL") profitPercent = profitPercent * -1;
      if (signal.action === "HOLD") profitPercent = 0;

      // RISK MANAGEMENT: Dynamic based on confidence
      let riskPercent = 0.01;
      if (signal.confidence > 90) riskPercent = 0.025;
      else if (signal.confidence > 80) riskPercent = 0.015;

      const currentBalance = balanceRef.current;
      const investment = currentBalance * riskPercent;
      const simulatedProfit = investment * profitPercent;

      const newLog: PredictionLog = {
        id: Date.now(),
        symbol: signal.symbol,
        action: signal.action,
        confidence: signal.confidence,
        time: new Date().toLocaleTimeString(),
        reason: `[WS] ${signal.reason} | Strategy: ${signal.strategy}`,
        simulatedProfit
      };

      setLogs(prev => [newLog, ...prev].slice(0, 50));

      // AUTO-TRADE LOGIC: If confidence > 75%, execute trade
      if (signal.confidence > 75 && signal.action !== "HOLD") {
        setBalance(prev => prev + simulatedProfit);
        const newTransaction: Transaction = {
          id: Date.now(),
          symbol: signal.symbol,
          action: signal.action as "BUY" | "SELL",
          amount: investment,
          profit: simulatedProfit,
          time: new Date().toLocaleTimeString()
        };
        setTransactions(prev => [newTransaction, ...prev].slice(0, 50));

        // Store trade in database (async, don't await)
        (async () => {
          try {
            const currentPrice = topGainers.find(s => s.symbol === signal.symbol)?.price || 
                                topLosers.find(s => s.symbol === signal.symbol)?.price ||
                                trendingStocks.find(s => s.symbol === signal.symbol)?.price ||
                                0;
            
            if (currentPrice > 0) {
              await storeTrade({
                symbol: signal.symbol,
                action: signal.action as "BUY" | "SELL",
                price: currentPrice,
                amount: investment,
                confidence: signal.confidence,
                strategy: signal.strategy || 'dashboard',
                reason: signal.reason
              });
              console.log(`[Dashboard] Stored trade in database: ${signal.symbol} ${signal.action}`);
            }
          } catch (error) {
            console.error('Failed to store trade in database:', error);
            // Continue even if storage fails - trade is still in local state
          }
        })();
      }

      console.log(`[WebSocket] AI Signal: ${signal.symbol} ${signal.action} (${signal.confidence.toFixed(1)}%) - ${signal.strategy}`);
    }
  }, [latestAISignal]);

  // Update market status every minute
  useEffect(() => {
    const updateMarketStatus = async () => {
      try {
        const status = await fetchMarketStatus();
        setMarketStatus(status);
        
        // Auto-adjust chart hours and real-time mode based on market status
        // Only auto-adjust on initial load or if user hasn't manually changed it
        if (!userManuallySetHours) {
          if (status.isOpen) {
            // Market is open: use 2 hours and enable real-time
            if (chartHours !== 2) {
              setChartHours(2);
            }
            if (!isRealTimeMode) {
              setIsRealTimeMode(true);
            }
          } else {
            // Market is closed: use 24 hours and disable real-time
            if (chartHours !== 24) {
              setChartHours(24);
            }
            if (isRealTimeMode) {
              setIsRealTimeMode(false);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch market status:', error);
      }
    };

    // Initial fetch
    updateMarketStatus();

    // Update every minute
    const interval = setInterval(updateMarketStatus, 60 * 1000);

    return () => clearInterval(interval);
  }, []); // Only run once on mount, don't depend on chartHours or isRealTimeMode

  // Function to refresh market data - calls all APIs
  const refreshMarketData = async () => {
    try {
      setRefreshing(true);
      setError(null);

      console.log('[Dashboard] Refreshing all market data...');

      // Popular stocks to pre-fetch
      const popularSymbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'NFLX'];

      // Call all APIs in parallel
      const [gainers, losers, trending, status] = await Promise.all([
        fetchMarketMovers('gainers', 20),
        fetchMarketMovers('losers', 20),
        fetchTrendingSymbols(20),
        fetchMarketStatus()
      ]);

      setMarketStatus(status);

      // Pre-fetch quotes for popular stocks
      const popularQuotesPromises = popularSymbols.map(symbol => 
        fetchStockQuote(symbol).catch(err => {
          console.warn(`Failed to fetch quote for ${symbol}:`, err);
          return null;
        })
      );
      const popularQuotes = await Promise.all(popularQuotesPromises);

      setTopGainers(gainers);
      setTopLosers(losers);
      
      // Convert trending symbols to StockQuote format
      if (trending && trending.symbols && trending.symbols.length > 0) {
        const trendingQuotes = await Promise.all(
          trending.symbols.map(async (symbol: string) => {
            try {
              const quote = await fetchStockQuote(symbol);
              return quote;
            } catch (err) {
              return null;
            }
          })
        );
        setTrendingStocks(trendingQuotes.filter(q => q !== null) as StockQuote[]);
      }

      console.log('[Dashboard] Market data refreshed:', {
        gainers: gainers.length,
        losers: losers.length,
        trending: trending.symbols?.length || 0,
        popularQuotes: popularQuotes.filter(q => q !== null).length
      });
    } catch (err) {
      console.error('Error refreshing market data:', err);
      setError('Failed to refresh market data');
    } finally {
      setRefreshing(false);
    }
  };

  // Reset manual hours flag when stock changes (allow auto-adjust for new stock)
  useEffect(() => {
    if (selectedStock) {
      setUserManuallySetHours(false);
      console.log(`[Chart] Stock changed to ${selectedStock.symbol}, resetting manual zoom flag`);
    }
  }, [selectedStock?.symbol]);

  // Update chart and indicators when stock changes
  useEffect(() => {
    const loadChartData = async () => {
      if (!selectedStock) return;

      try {
        console.log(`[Chart] Fetching intraday data for ${selectedStock.symbol}, last ${chartHours} hours...`);
        
        // Use intraday data for real-time view
        const intradayData = await fetchIntradayData(selectedStock.symbol, chartHours, 1000);
        console.log(`[Chart] Received ${intradayData?.length || 0} intraday data points for ${selectedStock.symbol}`);
        
        if (intradayData && intradayData.length > 0) {
          // Format time labels based on data granularity
          // Use system timezone for consistency
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const formattedData = intradayData.map((d: any) => {
            // Parse timestamp correctly - could be string (ISO) or number (ms)
            let timestamp: Date;
            let timestampMs: number;
            
            if (d.timestamp) {
              if (typeof d.timestamp === 'number') {
                timestampMs = d.timestamp;
                timestamp = new Date(d.timestamp);
              } else if (typeof d.timestamp === 'string') {
                timestamp = new Date(d.timestamp);
                timestampMs = timestamp.getTime();
              } else {
                timestamp = new Date();
                timestampMs = timestamp.getTime();
              }
            } else if (d.date) {
              timestamp = new Date(d.date);
              timestampMs = timestamp.getTime();
            } else {
              timestamp = new Date();
              timestampMs = timestamp.getTime();
            }
            
            // Ensure timestamp is valid
            if (isNaN(timestampMs)) {
              timestamp = new Date();
              timestampMs = timestamp.getTime();
            }
            
            let timeStr: string;
            
            if (chartHours <= 1) {
              // For 1 hour or less, show seconds
              timeStr = timestamp.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZone: timeZone
              });
            } else if (chartHours <= 6) {
              // For 2-6 hours, show minutes
              timeStr = timestamp.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false,
                timeZone: timeZone
              });
            } else {
              // For longer periods, show hours and minutes
              timeStr = timestamp.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false,
                timeZone: timeZone
              });
            }
            
            return {
              ...d,
              time: timeStr,
              date: d.date || timestamp.toISOString(),
              timestamp: timestampMs // Always use number (milliseconds) for consistency
            };
          });
          
          // Sort by timestamp to ensure correct order
          formattedData.sort((a: any, b: any) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.date).getTime());
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.date).getTime());
            return timeA - timeB;
          });
          
          console.log(`[Chart] Loaded ${formattedData.length} data points, time range: ${formattedData[0]?.time} to ${formattedData[formattedData.length - 1]?.time}`);
          setChartData(formattedData);
        } else {
          // Fallback: try daily historical data if no intraday data
          console.log(`[Chart] No intraday data, trying daily historical data...`);
          const historicalData = await fetchHistoricalData(selectedStock.symbol, 30);
          if (historicalData && historicalData.length > 0) {
            const dataWithDates = historicalData.map((d: any) => ({
              ...d,
              date: d.date || d.time || new Date().toISOString()
            }));
            setChartData(dataWithDates);
          } else {
            // Final fallback: generated data
            const generatedData = [];
            let price = selectedStock.price;
            const now = new Date();
            for (let i = 0; i < 20; i++) {
              price = price * (1 + (Math.random() * 0.04 - 0.02));
              const date = new Date(now);
              date.setDate(date.getDate() - (20 - i));
              generatedData.push({
                time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                price: price,
                date: date.toISOString()
              });
            }
            setChartData(generatedData);
          }
        }
      } catch (err) {
        console.error('Error loading chart data:', err);
        // Fallback to generated data
        const generatedData = [];
        let price = selectedStock.price;
        for (let i = 0; i < 20; i++) {
          price = price * (1 + (Math.random() * 0.04 - 0.02));
          generatedData.push({
            time: `${9 + Math.floor(i/2)}:${i % 2 === 0 ? '00' : '30'}`,
            price: price
          });
        }
        setChartData(generatedData);
      }
    };

    const loadIndicators = async () => {
      if (!selectedStock || !selectedStock.symbol) {
        console.warn('[Indicators] No selected stock or symbol, skipping indicators load');
        setIndicators(null);
        return;
      }

      try {
        setIndicatorsLoading(true);
        console.log(`[Indicators] Fetching technical indicators for ${selectedStock.symbol}...`);
        const indicatorsData = await fetchTechnicalIndicators(selectedStock.symbol, 30);
        console.log(`[Indicators] Received indicators for ${selectedStock.symbol}:`, indicatorsData);
        setIndicators(indicatorsData);
      } catch (err) {
        console.error('Error loading technical indicators:', err);
        // Set to null on error - will show fallback values
        setIndicators(null);
      } finally {
        setIndicatorsLoading(false);
      }
    };

    loadChartData();
    loadIndicators();
  }, [selectedStock]); // Only reload when stock changes, not when hours change (to respect manual zoom)
  
  // Separate effect to reload chart when hours change (only if user manually changed it)
  useEffect(() => {
    if (selectedStock && selectedStock.symbol && userManuallySetHours) {
      const loadChartData = async () => {
        try {
          console.log(`[Chart] Reloading data for manual zoom: ${chartHours} hours`);
          const intradayData = await fetchIntradayData(selectedStock.symbol, chartHours, 1000);
          
          if (intradayData && intradayData.length > 0) {
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const formattedData = intradayData.map((d: any) => {
              // Parse timestamp correctly - could be string (ISO) or number (ms)
              let timestamp: Date;
              let timestampMs: number;
              
              if (d.timestamp) {
                if (typeof d.timestamp === 'number') {
                  timestampMs = d.timestamp;
                  timestamp = new Date(d.timestamp);
                } else if (typeof d.timestamp === 'string') {
                  timestamp = new Date(d.timestamp);
                  timestampMs = timestamp.getTime();
                } else {
                  timestamp = new Date();
                  timestampMs = timestamp.getTime();
                }
              } else if (d.date) {
                timestamp = new Date(d.date);
                timestampMs = timestamp.getTime();
              } else {
                timestamp = new Date();
                timestampMs = timestamp.getTime();
              }
              
              // Ensure timestamp is valid
              if (isNaN(timestampMs)) {
                timestamp = new Date();
                timestampMs = timestamp.getTime();
              }
              
              let timeStr: string;
              
              if (chartHours <= 1) {
                timeStr = timestamp.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                  timeZone: timeZone
                });
              } else {
                timeStr = timestamp.toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: false,
                  timeZone: timeZone
                });
              }
              
              return {
                ...d,
                time: timeStr,
                date: d.date || timestamp.toISOString(),
                timestamp: timestampMs // Always use number (milliseconds) for consistency
              };
            });
            
            // Sort by timestamp
            formattedData.sort((a: any, b: any) => {
              const timeA = typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.date).getTime());
              const timeB = typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.date).getTime());
              return timeA - timeB;
            });
            
            setChartData(formattedData);
          }
        } catch (err) {
          console.error('Error reloading chart data for zoom:', err);
        }
      };
      
      loadChartData();
    }
  }, [chartHours, userManuallySetHours, selectedStock]);

  // Simulate Bot Activity with Advanced AI
  useEffect(() => {
    const interval = setInterval(async () => {
      if (topGainers.length === 0 && topLosers.length === 0 && trendingStocks.length === 0) return;

      // Randomly select from gainers, losers, or trending stocks
      const pools = [topGainers, topLosers, trendingStocks].filter(pool => pool.length > 0);
      const selectedPool = pools[Math.floor(Math.random() * pools.length)];
      const randomStock = selectedPool[Math.floor(Math.random() * selectedPool.length)];

      try {
        // Get real market data for AI analysis
        if (!randomStock || !randomStock.symbol) {
          console.warn('[Bot] Invalid stock selected, skipping AI signal');
          return;
        }
        
        const historicalData = await fetchHistoricalData(randomStock.symbol, 30).catch(err => {
          console.warn(`[Bot] Failed to fetch historical data for ${randomStock.symbol}:`, err);
          return [];
        }); // 30 days of daily data for AI analysis
        const currentPrice = randomStock.price || 0;
        const historicalPrices = historicalData && historicalData.length > 0 
          ? historicalData.map((d: any) => d.price || 0).filter((p: number) => p > 0)
          : [currentPrice]; // Fallback to current price if no historical data

        // Generate AI signal using advanced strategies via API
        const volumeStr = randomStock.vol || '0';
        const volume = volumeStr.includes('M') 
          ? parseInt(volumeStr.replace('M', '')) * 1000000
          : (volumeStr.includes('K') 
            ? parseInt(volumeStr.replace('K', '')) * 1000 
            : parseInt(volumeStr) || 0);
        
        const signal = await fetchAISignal({
          symbol: randomStock.symbol,
          price: currentPrice,
          volume: volume,
          historicalPrices: historicalPrices.length > 0 ? historicalPrices : [currentPrice],
          strategy: aiStrategyRef.current,
          sentimentScore: (Math.random() - 0.5) * 2 // Mock sentiment score
        }).catch(err => {
          console.warn(`[Bot] Failed to generate AI signal for ${randomStock.symbol}:`, err);
          // Return a default HOLD signal if API fails
          return {
            action: 'HOLD' as const,
            confidence: 50,
            reason: 'API error, defaulting to HOLD'
          };
        });

        const { action, confidence, reason } = signal;

        // Calculate simulated profit based on confidence and action
        let profitPercent = (Math.random() * 7 - 2) / 100;

        if (action === "SELL") profitPercent = profitPercent * -1;
        if (action === "HOLD") profitPercent = 0;

        // RISK MANAGEMENT: Dynamic based on confidence
        let riskPercent = 0.01;
        if (confidence > 90) riskPercent = 0.025;
        else if (confidence > 80) riskPercent = 0.015;

        const currentBalance = balanceRef.current;
        const investment = currentBalance * riskPercent;
        const simulatedProfit = investment * profitPercent;

        const newLog: PredictionLog = {
          id: Date.now(),
          symbol: randomStock.symbol,
          action: action as any,
          confidence,
          time: new Date().toLocaleTimeString(),
          reason,
          simulatedProfit
        };

        setLogs(prev => [newLog, ...prev].slice(0, 50));

        // AUTO-TRADE LOGIC: If confidence > 75%, execute trade
        if (confidence > 75 && action !== "HOLD") {
          setBalance(prev => prev + simulatedProfit);
          const newTransaction: Transaction = {
            id: Date.now(),
            symbol: randomStock.symbol,
            action: action as "BUY" | "SELL",
            amount: investment,
            profit: simulatedProfit,
            time: new Date().toLocaleTimeString()
          };
          setTransactions(prev => [newTransaction, ...prev].slice(0, 50));

          // Store trade in database (async, don't await)
          (async () => {
            try {
              await storeTrade({
                symbol: randomStock.symbol,
                action: action as "BUY" | "SELL",
                price: currentPrice,
                amount: investment,
                confidence: confidence,
                strategy: aiStrategyRef.current,
                reason: reason
              });
              console.log(`[Dashboard] Stored trade in database: ${randomStock.symbol} ${action}`);
            } catch (error) {
              console.error('Failed to store trade in database:', error);
              // Continue even if storage fails
            }
          })();
        }
      } catch (error) {
        console.error('AI signal generation error:', error);
        // Fallback to simple random logic
        const strategy = aiStrategyRef.current;
        let action = "HOLD";
        let confidence = 0;
        let reason = "";

        if (strategy === "neuro-scalp") {
          action = Math.random() > 0.6 ? "BUY" : (Math.random() > 0.5 ? "SELL" : "HOLD");
          confidence = Math.floor(Math.random() * 20) + 75;
          reason = "Fallback: Micro-structure analysis";
        } else if (strategy === "deep-momentum") {
          action = Math.random() > 0.7 ? "BUY" : (Math.random() > 0.6 ? "SELL" : "HOLD");
          confidence = Math.floor(Math.random() * 15) + 84;
          reason = "Fallback: Trend momentum analysis";
        } else if (strategy === "sentiment-flow") {
          action = Math.random() > 0.6 ? "BUY" : (Math.random() > 0.5 ? "SELL" : "HOLD");
          confidence = Math.floor(Math.random() * 25) + 70;
          reason = "Fallback: Sentiment flow analysis";
        }

        let profitPercent = (Math.random() * 7 - 2) / 100;
        if (action === "SELL") profitPercent = profitPercent * -1;
        if (action === "HOLD") profitPercent = 0;

        let riskPercent = 0.01;
        if (confidence > 90) riskPercent = 0.025;
        else if (confidence > 80) riskPercent = 0.015;

        const currentBalance = balanceRef.current;
        const investment = currentBalance * riskPercent;
        const simulatedProfit = investment * profitPercent;

        const newLog: PredictionLog = {
          id: Date.now(),
          symbol: randomStock.symbol,
          action: action as any,
          confidence,
          time: new Date().toLocaleTimeString(),
          reason,
          simulatedProfit
        };

        setLogs(prev => [newLog, ...prev].slice(0, 50));

        if (confidence > 75 && action !== "HOLD") {
          setBalance(prev => prev + simulatedProfit);
          const newTransaction: Transaction = {
            id: Date.now(),
            symbol: randomStock.symbol,
            action: action as "BUY" | "SELL",
            amount: investment,
            profit: simulatedProfit,
            time: new Date().toLocaleTimeString()
          };
          setTransactions(prev => [newTransaction, ...prev].slice(0, 50));

          // Store trade in database (async, don't await)
          (async () => {
            try {
              await storeTrade({
                symbol: randomStock.symbol,
                action: action as "BUY" | "SELL",
                price: randomStock.price,
                amount: investment,
                confidence: confidence,
                strategy: strategy,
                reason: reason
              });
              console.log(`[Dashboard] Stored trade in database: ${randomStock.symbol} ${action}`);
            } catch (error) {
              console.error('Failed to store trade in database:', error);
              // Continue even if storage fails
            }
          })();
        }
      }
    }, 3000); // New prediction every 3 seconds

    return () => clearInterval(interval);
  }, [topGainers, topLosers, trendingStocks]);

  // Simulate live chart movement (only if using generated data)
  useEffect(() => {
    if (chartData.length === 0 || !selectedStock) return;

    // Only update chart if we're using generated data (fallback)
    // Generated data has times like "9:00", "9:30" while real data has dates like "Dec 17"
    const isGeneratedData = chartData.length > 0 && chartData[0]?.time?.includes(':');

    if (!isGeneratedData) return;

    const interval = setInterval(() => {
      setChartData(currentData => {
        const newData = [...currentData];
        const lastPoint = newData[newData.length - 1];

        // Remove first point to keep window fixed size
        newData.shift();

        // Generate next price point
        const volatility = 0.005; // 0.5% volatility
        const change = 1 + (Math.random() * volatility * 2 - volatility);
        const newPrice = lastPoint.price * change;

        // Calculate new time label
        const lastTime = lastPoint.time.split(':');
        let hours = parseInt(lastTime[0]);
        let minutes = parseInt(lastTime[1]) + 5; // 5 minute intervals
        if (minutes >= 60) {
          hours += 1;
          minutes = 0;
        }

        const newPoint = {
          time: `${hours}:${minutes.toString().padStart(2, '0')}`,
          price: newPrice,
          date: new Date().toISOString() // Add date for tooltip
        };

        newData.push(newPoint);

        return newData;
      });
    }, 1000); // Update chart every 1 second

    return () => clearInterval(interval);
  }, [chartData, selectedStock]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md h-16 flex items-center px-6 justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Cpu className="w-6 h-6 text-primary animate-pulse" />
          <h1 className="text-xl font-bold tracking-widest text-primary font-orbitron">QUANTUM<span className="text-white">TRADE</span></h1>
          <Badge variant="outline" className="ml-4 border-primary/50 text-primary bg-primary/10 font-mono text-xs">
            v2.4.0 ONLINE
          </Badge>
        </div>
        <div className="flex items-center gap-6 text-sm font-rajdhani font-medium text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <span>Market: <span className={marketStatus?.isOpen ? "text-green-400 animate-pulse" : "text-red-400"}>{marketStatus?.isOpen ? "OPEN" : "CLOSED"}</span></span>
            {marketStatus && !marketStatus.isOpen && marketStatus.nextOpen && (
              <span className="text-xs text-gray-400 ml-2">
                Opens {new Date(marketStatus.nextOpen).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ET
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Risk: <span className="text-white">AUTO (1-2.5%)</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            <span>Balance: <span className="text-white font-mono text-lg">${balance.toFixed(2)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-500" />
            <span>Bot Status: <span className="text-green-400 animate-pulse">ACTIVE</span></span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span>Live Data: <span className={isConnected ? 'text-green-400' : 'text-red-400'}>{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span></span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 grid grid-cols-12 gap-6 overflow-hidden">
        
        {/* Left Sidebar - Watchlists */}
        <aside className="col-span-3 flex flex-col gap-4 h-[calc(100vh-7rem)] overflow-hidden">
          <Tabs defaultValue="gainers" className="w-full flex-1 flex flex-col min-h-0">
            <TabsList className="w-full grid grid-cols-3 bg-black/20 border border-white/10 rounded-none flex-shrink-0">
              <TabsTrigger value="gainers" className="rounded-none data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-orbitron text-xs">GAINERS</TabsTrigger>
              <TabsTrigger value="losers" className="rounded-none data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive font-orbitron text-xs">LOSERS</TabsTrigger>
              <TabsTrigger value="trending" className="rounded-none data-[state=active]:bg-secondary/20 data-[state=active]:text-secondary font-orbitron text-xs">TRENDING</TabsTrigger>
            </TabsList>

            {/* Refresh Button */}
            <div className="py-3 flex-shrink-0">
              <Button
                onClick={refreshMarketData}
                disabled={refreshing}
                variant="outline"
                size="sm"
                className="w-full bg-black/20 border-white/10 hover:bg-primary/10 hover:border-primary/50 text-white font-orbitron text-xs"
              >
                <RefreshCw className={`w-3 h-3 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'REFRESHING...' : 'UPDATE MARKET DATA'}
              </Button>
            </div>
            
            <div className="flex-1 min-h-0 relative">
              <TabsContent value="gainers" className="absolute inset-0 mt-0 data-[state=inactive]:hidden">
                <div className="h-full overflow-y-auto pr-2 custom-scrollbar space-y-2">
                  {loading ? (
                    <div className="text-center text-muted-foreground py-4">Loading market data...</div>
                  ) : topGainers.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4">No gainers data available</div>
                  ) : (
                    topGainers.map((stock) => (
                      <StockCard 
                        key={stock.symbol} 
                        stock={stock} 
                        isSelected={selectedStock?.symbol === stock.symbol}
                        onClick={() => setSelectedStock(stock)}
                        type="gainer"
                      />
                    ))
                  )}
                </div>
              </TabsContent>
              <TabsContent value="losers" className="absolute inset-0 mt-0 data-[state=inactive]:hidden">
                <div className="h-full overflow-y-auto pr-2 custom-scrollbar space-y-2">
                  {loading ? (
                    <div className="text-center text-muted-foreground py-4">Loading market data...</div>
                  ) : topLosers.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4">No losers data available</div>
                  ) : (
                    topLosers.map((stock) => (
                      <StockCard 
                        key={stock.symbol} 
                        stock={stock} 
                        isSelected={selectedStock?.symbol === stock.symbol}
                        onClick={() => setSelectedStock(stock)}
                        type="loser"
                      />
                    ))
                  )}
                </div>
              </TabsContent>
              <TabsContent value="trending" className="absolute inset-0 mt-0 data-[state=inactive]:hidden">
                <div className="h-full overflow-y-auto pr-2 custom-scrollbar space-y-2">
                  {loading ? (
                    <div className="text-center text-muted-foreground py-4">Loading trending data...</div>
                  ) : trendingStocks.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4">No trending data available</div>
                  ) : (
                    trendingStocks.map((stock) => (
                      <StockCard 
                        key={stock.symbol} 
                        stock={stock} 
                        isSelected={selectedStock?.symbol === stock.symbol}
                        onClick={() => setSelectedStock(stock)}
                        type="trending"
                      />
                    ))
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </aside>

        {/* Center - Charts & Analysis */}
        <section className="col-span-6 flex flex-col gap-6 h-[calc(100vh-7rem)]">
          {/* Main Chart Card */}
          <Card className="flex-1 bg-black/40 border-white/10 backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 gap-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-3xl font-orbitron tracking-wider text-white flex items-baseline gap-3">
                  {selectedStock?.symbol || 'Loading...'}
                  {selectedStock && (
                    <span className={`text-lg font-rajdhani ${isPositiveChange(selectedStock.change) ? 'text-primary' : 'text-destructive'}`}>
                      {selectedStock.currency ? `${selectedStock.currency} ` : '$'}{selectedStock.price.toFixed(2)}
                    </span>
                  )}
                </CardTitle>
                <p className="text-muted-foreground text-xs font-rajdhani uppercase tracking-widest mt-1">
                  {selectedStock?.name || 'Loading...'} {selectedStock?.vol && `• VOL: ${selectedStock.vol}`}
                </p>
              </div>
              {/* Chart Zoom Controls and Stock Change - All on same line */}
              <div className="flex items-center gap-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Chart Zoom Controls */}
                <div className="flex items-center gap-2 border-r border-white/10 pr-3" style={{ zIndex: 10 }}>
                  <button
                    onClick={() => {
                      const newHours = Math.max(1, chartHours - 1);
                      console.log(`[Chart] Button clicked! Decreasing hours: ${chartHours} -> ${newHours}`);
                      setUserManuallySetHours(true);
                      setChartHours(newHours);
                    }}
                    disabled={chartHours <= 1}
                    className="h-8 w-8 px-2 text-sm border border-white/30 rounded-md bg-black/40 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold cursor-pointer transition-all active:scale-95 relative z-10"
                    type="button"
                    aria-label="Decrease chart hours"
                  >
                    −
                  </button>
                  <span className="text-xs text-muted-foreground min-w-[60px] text-center font-mono select-none">
                    {chartHours}h
                  </span>
                  <button
                    onClick={() => {
                      const newHours = Math.min(24, chartHours + 1);
                      console.log(`[Chart] Button clicked! Increasing hours: ${chartHours} -> ${newHours}`);
                      setUserManuallySetHours(true);
                      setChartHours(newHours);
                    }}
                    disabled={chartHours >= 24}
                    className="h-8 w-8 px-2 text-sm border border-white/30 rounded-md bg-black/40 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white font-bold cursor-pointer transition-all active:scale-95 relative z-10"
                    type="button"
                    aria-label="Increase chart hours"
                  >
                    +
                  </button>
                </div>
                {/* Stock Change Badge - Inline with zoom controls */}
                {selectedStock && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`font-mono text-sm px-3 py-1 whitespace-nowrap ${isPositiveChange(selectedStock.change) ? 'border-primary text-primary bg-primary/10' : 'border-destructive text-destructive bg-destructive/10'}`}>
                      {selectedStock.changeFormatted || formatChangePercent(selectedStock.changePercent || 0)}
                    </Badge>
                    {selectedStock.change !== undefined && (
                      <span className={`text-xs font-mono whitespace-nowrap ${isPositiveChange(selectedStock.change) ? 'text-primary' : 'text-destructive'}`}>
                        {formatChangeAmount(selectedStock.change, selectedStock.currency)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)] w-full">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Loading chart data...</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={selectedStock && isPositiveChange(selectedStock.change) ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={selectedStock && isPositiveChange(selectedStock.change) ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="time" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#666" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#000', borderColor: '#333', color: '#fff' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: any, name: string, props: any) => {
                        const currency = selectedStock?.currency || 'USD';
                        const symbol = currency === 'USD' ? '$' : currency + ' ';
                        return [`${symbol}${Number(value).toFixed(2)}`, 'Price'];
                      }}
                      labelFormatter={(label: string) => {
                        // Find the full date from chartData
                        const dataPoint = chartData.find((d: any) => d.time === label);
                        if (dataPoint && dataPoint.date) {
                          const date = new Date(dataPoint.date);
                          return date.toLocaleString('en-US', { 
                            month: 'short', 
                            day: 'numeric', 
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          });
                        }
                        return label;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="price" 
                      stroke={selectedStock && isPositiveChange(selectedStock.change) ? "var(--color-primary)" : "var(--color-destructive)"} 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-4 h-32">
            {indicatorsLoading ? (
              <>
                <StatCard title="RSI (14)" value="..." status="neutral" />
                <StatCard title="MACD" value="..." status="neutral" />
                <StatCard title="VOLATILITY" value="..." status="neutral" />
              </>
            ) : indicators ? (
              <>
                <StatCard 
                  title="RSI (14)" 
                  value={indicators.indicators.rsi.value.toFixed(1)} 
                  status={
                    indicators.indicators.rsi.level === 'Overbought' ? 'warning' :
                    indicators.indicators.rsi.level === 'Oversold' ? 'positive' :
                    'neutral'
                  }
                />
                <StatCard 
                  title="MACD" 
                  value={`${indicators.indicators.macd.value >= 0 ? '+' : ''}${indicators.indicators.macd.value.toFixed(3)}`} 
                  status={
                    indicators.indicators.macd.histogram > 0 ? 'positive' :
                    indicators.indicators.macd.histogram < 0 ? 'negative' :
                    'neutral'
                  }
                />
                <StatCard 
                  title="VOLATILITY" 
                  value={`${indicators.indicators.volatility.value.toFixed(1)}%`} 
                  status={
                    indicators.indicators.volatility.level === 'High' ? 'warning' :
                    indicators.indicators.volatility.level === 'Low' ? 'positive' :
                    'neutral'
                  }
                />
              </>
            ) : (
              <>
                <StatCard title="RSI (14)" value="N/A" status="neutral" />
                <StatCard title="MACD" value="N/A" status="neutral" />
                <StatCard title="VOLATILITY" value="N/A" status="neutral" />
              </>
            )}
          </div>
        </section>

        {/* Right Sidebar - Live Bot Logs & Transactions */}
        <aside className="col-span-3 flex flex-col h-[calc(100vh-7rem)] gap-4">
          
          {/* AI Strategy Control Panel */}
          <div className="bg-black/20 border border-white/10 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-orbitron text-sm text-white tracking-widest flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-secondary" /> AI STRATEGY
              </h3>
              <Badge variant="outline" className="text-[10px] h-4 border-secondary/50 text-secondary bg-secondary/10">ACTIVE</Badge>
            </div>
            <Select value={aiStrategy} onValueChange={setAiStrategy}>
              <SelectTrigger className="w-full bg-black/40 border-white/10 h-8 text-xs font-mono">
                <SelectValue placeholder="Select Strategy" />
              </SelectTrigger>
              <SelectContent className="bg-black/90 border-white/10 text-white">
                <SelectItem value="neuro-scalp">NEURO-SCALP (High Freq)</SelectItem>
                <SelectItem value="deep-momentum">DEEP-MOMENTUM (Trend)</SelectItem>
                <SelectItem value="sentiment-flow">SENTIMENT-FLOW (News)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Live Signals Panel (Top Half) */}
          <div className="flex-1 flex flex-col bg-black/20 border border-white/10 overflow-hidden">
            <div className="p-3 border-b border-white/10 bg-black/40 flex items-center justify-between">
              <h3 className="font-orbitron text-sm text-primary tracking-widest flex items-center gap-2">
                <Activity className="w-4 h-4" /> LIVE SIGNALS
              </h3>
              <span className="text-[10px] text-muted-foreground font-mono animate-pulse">SCANNING...</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="p-3 rounded border border-white/5 bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-white font-mono">{log.symbol}</span>
                      <span className="text-[10px] text-muted-foreground">{log.time}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge 
                        variant="outline" 
                        className={`text-[10px] h-5 px-1 border-0 ${
                          log.action === 'BUY' ? 'bg-primary/20 text-primary' : 
                          log.action === 'SELL' ? 'bg-destructive/20 text-destructive' : 
                          'bg-white/10 text-white'
                        }`}
                      >
                        {log.action}
                      </Badge>
                      <span className={`text-xs font-mono font-bold ${log.confidence > 85 ? 'text-green-400' : 'text-yellow-400'}`}>
                        {log.confidence}% CONF
                      </span>
                    </div>
                    
                    {/* Simulated Profit Section */}
                    {log.action !== 'HOLD' && (
                      <div className="mt-2 p-2 bg-black/40 rounded border border-white/5 flex justify-between items-center">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          Risk {(log.confidence > 90 ? 2.5 : log.confidence > 80 ? 1.5 : 1.0)}%:
                        </span>
                        <span className={`text-xs font-bold font-mono ${log.simulatedProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                          {log.simulatedProfit >= 0 ? '+' : ''}${log.simulatedProfit.toFixed(2)}
                        </span>
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground mt-2 font-mono leading-relaxed border-t border-white/5 pt-1">
                      <span className="text-white/50">REASON:</span> {log.reason}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Transactions Panel (Bottom Half) */}
          <div className="flex-1 flex flex-col bg-black/20 border border-white/10 overflow-hidden">
            <div className="p-3 border-b border-white/10 bg-black/40 flex items-center justify-between">
              <h3 className="font-orbitron text-sm text-secondary tracking-widest flex items-center gap-2">
                <Zap className="w-4 h-4" /> EXECUTED TRADES
              </h3>
              <span className="text-[10px] text-muted-foreground font-mono">CONF &gt; 75%</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              <AnimatePresence initial={false}>
                {transactions.map((tx) => (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-2 rounded border border-white/5 bg-white/5 flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono text-sm">{tx.symbol}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] h-4 px-1 border-0 ${
                            tx.action === 'BUY' ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'
                          }`}
                        >
                          {tx.action}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">{tx.time}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold font-mono ${tx.profit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {tx.profit >= 0 ? '+' : ''}${tx.profit.toFixed(2)}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">BAL: ${(balance + tx.profit).toFixed(2)}</span>
                    </div>
                  </motion.div>
                ))}
                {transactions.length === 0 && (
                  <div className="text-center text-muted-foreground text-xs py-4 font-mono opacity-50">
                    WAITING FOR HIGH CONFIDENCE SIGNALS...
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </aside>

      </main>
    </div>
  );
}

function StockCard({ stock, isSelected, onClick, type }: { stock: Stock, isSelected: boolean, onClick: () => void, type: 'gainer' | 'loser' | 'trending' }) {
  const getBorderColor = () => {
    if (isSelected) {
      if (type === 'gainer') return 'border-l-primary';
      if (type === 'loser') return 'border-l-destructive';
      if (type === 'trending') return 'border-l-secondary';
    }
    return 'border-l-transparent';
  };

  const getChangeColor = () => {
    if (type === 'gainer') return 'text-primary';
    if (type === 'loser') return 'text-destructive';
    if (type === 'trending') {
      // For trending, use color based on change value
      // Handle both string and number types
      if (typeof stock.change === 'string') {
        return stock.change.startsWith('+') ? 'text-primary' : stock.change.startsWith('-') ? 'text-destructive' : 'text-secondary';
      } else if (typeof stock.change === 'number') {
        return stock.change > 0 ? 'text-primary' : stock.change < 0 ? 'text-destructive' : 'text-secondary';
      } else if (stock.changePercent !== undefined) {
        // Fallback to changePercent if change is not available
        return stock.changePercent > 0 ? 'text-primary' : stock.changePercent < 0 ? 'text-destructive' : 'text-secondary';
      }
      return 'text-secondary';
    }
    return 'text-white';
  };

  return (
    <div 
      onClick={onClick}
      className={`
        p-3 rounded cursor-pointer transition-all duration-200 border-l-2
        ${isSelected 
          ? `bg-white/10 ${getBorderColor()}` 
          : 'bg-black/20 border-l-transparent hover:bg-white/5'
        }
      `}
    >
      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-bold text-sm text-white font-mono">{stock.symbol}</h4>
          <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">{stock.name}</p>
        </div>
        <div className="text-right">
          <p className={`text-sm font-bold font-mono ${getChangeColor()}`}>
            {(() => {
              if (typeof stock.change === 'string') {
                return stock.change;
              } else if (typeof stock.change === 'number') {
                return `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%`;
              } else if (stock.changePercent !== undefined) {
                return `${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%`;
              }
              return 'N/A';
            })()}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {stock.currency ? `${stock.currency} ` : '$'}{typeof stock.price === 'number' ? stock.price.toFixed(2) : stock.price}
          </p>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value, status }: { title: string, value: string, status: 'positive' | 'negative' | 'neutral' | 'warning' }) {
  const getColor = () => {
    switch(status) {
      case 'positive': return 'text-primary';
      case 'negative': return 'text-destructive';
      case 'warning': return 'text-yellow-500';
      default: return 'text-white';
    }
  }

  return (
    <div className="bg-black/40 border border-white/10 p-3 flex flex-col justify-center items-center backdrop-blur-sm">
      <span className="text-[10px] text-muted-foreground font-orbitron tracking-widest mb-1">{title}</span>
      <span className={`text-xl font-bold font-mono ${getColor()}`}>{value}</span>
    </div>
  )
}
