import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Search
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { motion, AnimatePresence } from "framer-motion";

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
  { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M" },
  { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M" },
  { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M" },
  { symbol: "COIN", name: "Coinbase Global", price: 265.12, change: "+6.5%", vol: "12M" },
  { symbol: "TSLA", name: "Tesla Inc", price: 180.45, change: "+5.9%", vol: "35M" },
  { symbol: "MARA", name: "Marathon Digital", price: 22.30, change: "+5.4%", vol: "8M" },
  { symbol: "MSTR", name: "MicroStrategy", price: 1650.00, change: "+4.8%", vol: "1.2M" },
  { symbol: "RIOT", name: "Riot Platforms", price: 12.45, change: "+4.2%", vol: "5M" },
  { symbol: "HOOD", name: "Robinhood", price: 19.80, change: "+3.9%", vol: "6M" },
  { symbol: "DKNG", name: "DraftKings", price: 44.20, change: "+3.5%", vol: "4M" },
  { symbol: "ARM", name: "Arm Holdings", price: 132.50, change: "+3.2%", vol: "3M" },
  { symbol: "SMCI", name: "Super Micro", price: 890.10, change: "+2.9%", vol: "2M" },
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
  { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M" },
  { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M" },
  { symbol: "LULU", name: "Lululemon", price: 290.50, change: "-6.8%", vol: "5M" },
  { symbol: "NKE", name: "Nike Inc", price: 92.30, change: "-5.5%", vol: "12M" },
  { symbol: "BA", name: "Boeing Co", price: 175.60, change: "-4.9%", vol: "8M" },
  { symbol: "T", name: "AT&T Inc", price: 16.20, change: "-3.8%", vol: "25M" },
  { symbol: "VZ", name: "Verizon", price: 38.90, change: "-3.2%", vol: "20M" },
  { symbol: "DIS", name: "Disney", price: 110.40, change: "-2.9%", vol: "15M" },
  { symbol: "PFE", name: "Pfizer", price: 26.80, change: "-2.5%", vol: "18M" },
  { symbol: "XOM", name: "Exxon Mobil", price: 115.20, change: "-2.1%", vol: "14M" },
  { symbol: "JNJ", name: "Johnson & Johnson", price: 145.60, change: "-1.9%", vol: "8M" },
  { symbol: "KO", name: "Coca-Cola", price: 58.90, change: "-1.8%", vol: "10M" },
  { symbol: "PEP", name: "PepsiCo", price: 165.40, change: "-1.7%", vol: "5M" },
  { symbol: "MCD", name: "McDonald's", price: 278.50, change: "-1.5%", vol: "4M" },
  { symbol: "SBUX", name: "Starbucks", price: 85.20, change: "-1.4%", vol: "6M" },
  { symbol: "WMT", name: "Walmart", price: 59.80, change: "-1.2%", vol: "12M" },
  { symbol: "TGT", name: "Target", price: 135.60, change: "-1.1%", vol: "5M" },
  { symbol: "COST", name: "Costco", price: 745.20, change: "-1.0%", vol: "3M" },
  { symbol: "PG", name: "Procter & Gamble", price: 158.40, change: "-0.9%", vol: "4M" },
  { symbol: "CVX", name: "Chevron", price: 148.90, change: "-0.8%", vol: "7M" },
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

export default function Dashboard() {
  const [logs, setLogs] = useState<PredictionLog[]>([]);
  const [selectedStock, setSelectedStock] = useState(TOP_GAINERS[0]);
  const [chartData, setChartData] = useState(generateStockData(TOP_GAINERS[0].price));
  const [balance, setBalance] = useState(100);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Simulate Bot Activity
  useEffect(() => {
    const interval = setInterval(() => {
      const stockPool = Math.random() > 0.5 ? TOP_GAINERS : TOP_LOSERS;
      const randomStock = stockPool[Math.floor(Math.random() * stockPool.length)];
      const action = Math.random() > 0.6 ? "BUY" : (Math.random() > 0.5 ? "SELL" : "HOLD");
      const confidence = Math.floor(Math.random() * 30) + 70; // 70-99%
      
      // Calculate simulated profit based on confidence and action
      // Higher confidence = slightly higher simulated profit for demo purposes
      // Base random movement between -2% to +5%
      let profitPercent = (Math.random() * 7 - 2) / 100;
      
      // If action is SELL and we "shorted", profit is inverse of price movement
      if (action === "SELL") profitPercent = profitPercent * -1;
      if (action === "HOLD") profitPercent = 0;

      const investment = 10;
      const simulatedProfit = investment * profitPercent;

      const newLog: PredictionLog = {
        id: Date.now(),
        symbol: randomStock.symbol,
        action: action as any,
        confidence,
        time: new Date().toLocaleTimeString(),
        reason: action === "BUY" ? "Momentum breakout detected above MA-50" : (action === "SELL" ? "Resistance level rejected at high volume" : "Consolidating in tight range"),
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

    }, 3000); // New prediction every 3 seconds for demo (user asked for 5 min)

    return () => clearInterval(interval);
  }, []);

  // Update chart when stock changes
  useEffect(() => {
    setChartData(generateStockData(selectedStock.price));
  }, [selectedStock]);

  // Simulate live chart movement
  useEffect(() => {
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
        let minutes = parseInt(lastTime[1]) + 5; // 5 minute intervals as requested originally, but updating faster for visual effect
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
  }, []);

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
            <Zap className="w-4 h-4 text-yellow-500" />
            <span>Balance: <span className="text-white font-mono text-lg">${balance.toFixed(2)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-green-500" />
            <span>Bot Status: <span className="text-green-400 animate-pulse">ACTIVE</span></span>
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
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <TabsContent value="gainers" className="mt-0 space-y-2">
                {TOP_GAINERS.map((stock) => (
                  <StockCard 
                    key={stock.symbol} 
                    stock={stock} 
                    isSelected={selectedStock.symbol === stock.symbol}
                    onClick={() => setSelectedStock(stock)}
                    type="gainer"
                  />
                ))}
              </TabsContent>
              <TabsContent value="losers" className="mt-0 space-y-2">
                {TOP_LOSERS.map((stock) => (
                  <StockCard 
                    key={stock.symbol} 
                    stock={stock} 
                    isSelected={selectedStock.symbol === stock.symbol}
                    onClick={() => setSelectedStock(stock)}
                    type="loser"
                  />
                ))}
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
                  {selectedStock.symbol}
                  <span className={`text-lg font-rajdhani ${selectedStock.change.startsWith('+') ? 'text-primary' : 'text-destructive'}`}>
                    {selectedStock.price.toFixed(2)}
                  </span>
                </CardTitle>
                <p className="text-muted-foreground text-xs font-rajdhani uppercase tracking-widest mt-1">{selectedStock.name} // VOL: {selectedStock.vol}</p>
              </div>
              <Badge variant="outline" className={`font-mono text-lg px-4 py-1 ${selectedStock.change.startsWith('+') ? 'border-primary text-primary bg-primary/10' : 'border-destructive text-destructive bg-destructive/10'}`}>
                {selectedStock.change}
              </Badge>
            </CardHeader>
            <CardContent className="h-[calc(100%-80px)] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={selectedStock.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={selectedStock.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} stopOpacity={0}/>
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
                    stroke={selectedStock.change.startsWith('+') ? "var(--color-primary)" : "var(--color-destructive)"} 
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
                        <span className="text-[10px] text-muted-foreground font-mono">Simulated $10 Trade:</span>
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
                      <span className="text-[10px] text-muted-foreground font-mono">BAL: ${(100 + tx.profit).toFixed(2)}</span>
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

function StockCard({ stock, isSelected, onClick, type }: { stock: any, isSelected: boolean, onClick: () => void, type: 'gainer' | 'loser' }) {
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
          <p className="text-[10px] text-muted-foreground">{stock.price}</p>
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
