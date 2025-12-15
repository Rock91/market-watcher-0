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
import { fetchStockQuote, fetchHistoricalData, fetchMarketMovers, type StockQuote } from "@/lib/api";
import { useWebSocket, type PriceUpdate, type MarketMover } from "@/hooks/use-websocket";

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
  change: string;
  vol: string;
  currency?: string;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // WebSocket connection for real-time updates
  const { isConnected, priceUpdates, marketMovers, error: wsError } = useWebSocket('ws://localhost:3001', [
    'AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'META', 'NFLX', 'GOOG'
  ]);

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

  // Load initial market data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [gainers, losers] = await Promise.all([
          fetchMarketMovers('gainers', 20),
          fetchMarketMovers('losers', 20)
        ]);

        setTopGainers(gainers);
        setTopLosers(losers);

        // Set initial selected stock
        if (gainers.length > 0) {
          setSelectedStock(gainers[0]);
        }
      } catch (err) {
        console.error('Error loading initial data:', err);
        setError('Failed to load market data. Using demo mode.');
        // Fallback to mock data if API fails
        setTopGainers([
          { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M", currency: "USD" },
          { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M", currency: "USD" },
          { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M", currency: "USD" },
        ]);
        setTopLosers([
          { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M", currency: "USD" },
          { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M", currency: "USD" },
        ]);
        if (!selectedStock) {
          setSelectedStock({ symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M", currency: "USD" });
        }
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Handle real-time market movers updates from WebSocket
  useEffect(() => {
    if (marketMovers) {
      console.log('Received real-time market movers update:', marketMovers.gainers.length, 'gainers,', marketMovers.losers.length, 'losers');
      setTopGainers(marketMovers.gainers.map(mover => ({
        symbol: mover.symbol,
        name: mover.name,
        price: mover.price,
        change: mover.change,
        vol: 'N/A', // Volume not included in market movers data
        currency: 'USD'
      })));
      setTopLosers(marketMovers.losers.map(mover => ({
        symbol: mover.symbol,
        name: mover.name,
        price: mover.price,
        change: mover.change,
        vol: 'N/A', // Volume not included in market movers data
        currency: 'USD'
      })));
    }
  }, [marketMovers]);

  // Handle real-time price updates from WebSocket
  useEffect(() => {
    if (priceUpdates.length > 0) {
      const latestUpdate = priceUpdates[priceUpdates.length - 1];

      // Update gainers list
      setTopGainers(prev => prev.map(stock =>
        stock.symbol === latestUpdate.symbol
          ? {
              ...stock,
              price: latestUpdate.price,
              change: `${latestUpdate.changePercent >= 0 ? '+' : ''}${(latestUpdate.changePercent * 100).toFixed(2)}%`
            }
          : stock
      ));

      // Update losers list
      setTopLosers(prev => prev.map(stock =>
        stock.symbol === latestUpdate.symbol
          ? {
              ...stock,
              price: latestUpdate.price,
              change: `${latestUpdate.changePercent >= 0 ? '+' : ''}${(latestUpdate.changePercent * 100).toFixed(2)}%`
            }
          : stock
      ));

      // Update selected stock if it's the one being updated
      if (selectedStock && selectedStock.symbol === latestUpdate.symbol) {
        setSelectedStock(prev => prev ? {
          ...prev,
          price: latestUpdate.price,
          change: `${latestUpdate.changePercent >= 0 ? '+' : ''}${(latestUpdate.changePercent * 100).toFixed(2)}%`
        } : null);
      }

      console.log(`Real-time update: ${latestUpdate.symbol} $${latestUpdate.price.toFixed(2)} (${(latestUpdate.changePercent * 100).toFixed(2)}%)`);
    }
  }, [priceUpdates]);

  // Function to refresh market data
  const refreshMarketData = async () => {
    try {
      setRefreshing(true);
      setError(null);

      const [gainers, losers] = await Promise.all([
        fetchMarketMovers('gainers', 20),
        fetchMarketMovers('losers', 20)
      ]);

      setTopGainers(gainers);
      setTopLosers(losers);
    } catch (err) {
      console.error('Error refreshing market data:', err);
      setError('Failed to refresh market data');
    } finally {
      setRefreshing(false);
    }
  };

  // Update chart when stock changes
  useEffect(() => {
    const loadChartData = async () => {
      if (!selectedStock) return;

      try {
        const historicalData = await fetchHistoricalData(selectedStock.symbol, 1); // 1 day of 5-minute data
        if (historicalData.length > 0) {
          setChartData(historicalData);
        } else {
          // Fallback to generated data if no historical data
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

    loadChartData();
  }, [selectedStock]);

  // Simulate Bot Activity with Advanced AI
  useEffect(() => {
    const interval = setInterval(async () => {
      if (topGainers.length === 0 && topLosers.length === 0) return;

      const stockPool = Math.random() > 0.5 ? topGainers : topLosers;
      const randomStock = stockPool[Math.floor(Math.random() * stockPool.length)];

      try {
        // Get real market data for AI analysis
        const historicalData = await fetchHistoricalData(randomStock.symbol, 1); // 1 day of data
        const currentPrice = randomStock.price;
        const historicalPrices = historicalData.map((d: any) => d.price);

        // Generate AI signal using advanced strategies via API
        const response = await fetch('/api/ai/signal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol: randomStock.symbol,
            price: currentPrice,
            volume: parseInt(randomStock.vol.replace('M', '')) * 1000000,
            historicalPrices,
            strategy: aiStrategyRef.current,
            sentimentScore: (Math.random() - 0.5) * 2 // Mock sentiment score
          })
        });

        if (!response.ok) {
          throw new Error('Failed to generate AI signal');
        }

        const signal = await response.json();
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
        }
      }
    }, 3000); // New prediction every 3 seconds

    return () => clearInterval(interval);
  }, [topGainers, topLosers]);

  // Simulate live chart movement (only if using generated data)
  useEffect(() => {
    if (chartData.length === 0 || !selectedStock) return;

    // Only update chart if we're using generated data (fallback)
    const isGeneratedData = chartData.length === 20 && chartData[0]?.time?.includes(':');

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

        newData.push({
          time: `${hours}:${minutes.toString().padStart(2, '0')}`,
          price: newPrice
        });

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
            <span>Market: <span className="text-white">OPEN</span></span>
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
        <aside className="col-span-3 flex flex-col gap-6 h-[calc(100vh-7rem)]">
          <Tabs defaultValue="gainers" className="w-full flex-1 flex flex-col">
            <TabsList className="w-full grid grid-cols-2 bg-black/20 border border-white/10 rounded-none mb-4">
              <TabsTrigger value="gainers" className="rounded-none data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-orbitron text-xs">TOP GAINERS</TabsTrigger>
              <TabsTrigger value="losers" className="rounded-none data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive font-orbitron text-xs">TOP LOSERS</TabsTrigger>
            </TabsList>

            {/* Refresh Button */}
            <div className="mb-4">
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
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <TabsContent value="gainers" className="mt-0 space-y-2">
                {loading ? (
                  <div className="text-center text-muted-foreground py-4">Loading market data...</div>
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
              </TabsContent>
              <TabsContent value="losers" className="mt-0 space-y-2">
                {loading ? (
                  <div className="text-center text-muted-foreground py-4">Loading market data...</div>
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
              </TabsContent>
            </div>
          </Tabs>
        </aside>

        {/* Center - Charts & Analysis */}
        <section className="col-span-6 flex flex-col gap-6 h-[calc(100vh-7rem)]">
          {/* Main Chart Card */}
          <Card className="flex-1 bg-black/40 border-white/10 backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-3xl font-orbitron tracking-wider text-white flex items-baseline gap-3">
                  {selectedStock?.symbol || 'Loading...'}
                  {selectedStock && (
                    <span className={`text-lg font-rajdhani ${selectedStock.change.startsWith('+') ? 'text-primary' : 'text-destructive'}`}>
                      {selectedStock.currency ? `${selectedStock.currency} ` : '$'}{selectedStock.price.toFixed(2)}
                    </span>
                  )}
                </CardTitle>
                <p className="text-muted-foreground text-xs font-rajdhani uppercase tracking-widest mt-1">
                  {selectedStock?.name || 'Loading...'} // VOL: {selectedStock?.vol || 'N/A'}
                </p>
              </div>
              {selectedStock && (
                <Badge variant="outline" className={`font-mono text-lg px-4 py-1 ${selectedStock.change.startsWith('+') ? 'border-primary text-primary bg-primary/10' : 'border-destructive text-destructive bg-destructive/10'}`}>
                  {selectedStock.change}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={selectedStock?.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={selectedStock?.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="time" stroke="#666" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#666" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#000', borderColor: '#333', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="price" 
                    stroke={selectedStock?.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorPrice)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-4 h-32">
             <StatCard title="RSI (14)" value="68.4" status="neutral" />
             <StatCard title="MACD" value="+0.45" status="positive" />
             <StatCard title="VOLATILITY" value="High" status="warning" />
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

function StockCard({ stock, isSelected, onClick, type }: { stock: Stock, isSelected: boolean, onClick: () => void, type: 'gainer' | 'loser' }) {
  return (
    <div 
      onClick={onClick}
      className={`
        p-3 rounded cursor-pointer transition-all duration-200 border-l-2
        ${isSelected 
          ? 'bg-white/10 border-l-primary' 
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
          <p className={`text-sm font-bold font-mono ${type === 'gainer' ? 'text-primary' : 'text-destructive'}`}>
            {stock.change}
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
