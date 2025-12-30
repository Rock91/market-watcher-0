import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  TrendingUp,
  TrendingDown,
  BarChart3,
  RefreshCw,
  ExternalLink,
  Home,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { fetchAllStocks, fetchHistoricalData, type StockWithQuote } from "@/lib/api";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function StocksDashboard() {
  const [stocks, setStocks] = useState<StockWithQuote[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<StockWithQuote[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedStock, setSelectedStock] = useState<StockWithQuote | null>(null);
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof StockWithQuote | null; direction: 'asc' | 'desc' }>({
    key: null,
    direction: 'asc'
  });

  useEffect(() => {
    loadStocks();
  }, []);

  useEffect(() => {
    filterStocks();
  }, [searchQuery, stocks]);

  const loadStocks = async () => {
    try {
      setLoading(true);
      const data = await fetchAllStocks(1000, 7);
      setStocks(data);
      setFilteredStocks(data);
    } catch (error) {
      console.error("Error loading stocks:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterStocks = () => {
    if (!searchQuery.trim()) {
      setFilteredStocks(stocks);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = stocks.filter(
      (stock) =>
        stock.symbol.toLowerCase().includes(query) ||
        stock.name.toLowerCase().includes(query)
    );
    setFilteredStocks(filtered);
  };

  const handleSort = (key: keyof StockWithQuote) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }

    setSortConfig({ key, direction });

    const sorted = [...filteredStocks].sort((a, b) => {
      const aValue = a[key];
      const bValue = b[key];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return direction === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });

    setFilteredStocks(sorted);
  };

  const handleViewHistory = async (stock: StockWithQuote) => {
    setSelectedStock(stock);
    setLoadingHistory(true);
    try {
      const data = await fetchHistoricalData(stock.symbol, 30);
      setHistoricalData(data);
    } catch (error) {
      console.error("Error loading historical data:", error);
      setHistoricalData([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1_000_000_000) {
      return `${(volume / 1_000_000_000).toFixed(2)}B`;
    }
    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(2)}M`;
    }
    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(2)}K`;
    }
    return volume.toString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
        >
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
              Stocks Dashboard
            </h1>
            <p className="text-slate-300">
              View all tracked stocks and their historical data
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/">
              <Button
                variant="outline"
                className="bg-white/10 text-white border-white/20 hover:bg-white/20"
              >
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            </Link>
            <Button
              onClick={loadStocks}
              disabled={loading}
              variant="outline"
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white/10 backdrop-blur border-white/20">
            <CardContent className="pt-6">
              <div className="text-sm text-slate-300 mb-1">Total Stocks</div>
              <div className="text-2xl font-bold text-white">{stocks.length}</div>
            </CardContent>
          </Card>
          <Card className="bg-white/10 backdrop-blur border-white/20">
            <CardContent className="pt-6">
              <div className="text-sm text-slate-300 mb-1">Gainers</div>
              <div className="text-2xl font-bold text-green-400">
                {stocks.filter(s => s.changePercent > 0).length}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/10 backdrop-blur border-white/20">
            <CardContent className="pt-6">
              <div className="text-sm text-slate-300 mb-1">Losers</div>
              <div className="text-2xl font-bold text-red-400">
                {stocks.filter(s => s.changePercent < 0).length}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/10 backdrop-blur border-white/20">
            <CardContent className="pt-6">
              <div className="text-sm text-slate-300 mb-1">Filtered</div>
              <div className="text-2xl font-bold text-white">{filteredStocks.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card className="bg-white/10 backdrop-blur border-white/20">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
              <Input
                placeholder="Search by symbol or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-white/5 border-white/20 text-white placeholder:text-slate-400"
              />
            </div>
          </CardContent>
        </Card>

        {/* Stocks Table */}
        <Card className="bg-white/10 backdrop-blur border-white/20">
          <CardHeader>
            <CardTitle className="text-white">All Stocks</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-slate-300">Loading stocks...</div>
            ) : filteredStocks.length === 0 ? (
              <div className="text-center py-8 text-slate-300">No stocks found</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/20 hover:bg-white/5">
                      <TableHead
                        className="text-slate-300 cursor-pointer hover:text-white"
                        onClick={() => handleSort('symbol')}
                      >
                        Symbol {sortConfig.key === 'symbol' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="text-slate-300 cursor-pointer hover:text-white"
                        onClick={() => handleSort('name')}
                      >
                        Name {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="text-slate-300 cursor-pointer hover:text-white"
                        onClick={() => handleSort('price')}
                      >
                        Price {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="text-slate-300 cursor-pointer hover:text-white"
                        onClick={() => handleSort('changePercent')}
                      >
                        Change {sortConfig.key === 'changePercent' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="text-slate-300 cursor-pointer hover:text-white"
                        onClick={() => handleSort('volume')}
                      >
                        Volume {sortConfig.key === 'volume' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead className="text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStocks.map((stock) => (
                      <TableRow
                        key={stock.symbol}
                        className="border-white/20 hover:bg-white/5"
                      >
                        <TableCell className="font-medium text-white">
                          {stock.symbol}
                        </TableCell>
                        <TableCell className="text-slate-300">{stock.name}</TableCell>
                        <TableCell className="text-white">
                          {formatPrice(stock.price)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              stock.changePercent >= 0 ? "default" : "destructive"
                            }
                            className={
                              stock.changePercent >= 0
                                ? "bg-green-500/20 text-green-400 border-green-500/50"
                                : "bg-red-500/20 text-red-400 border-red-500/50"
                            }
                          >
                            {stock.changePercent >= 0 ? (
                              <TrendingUp className="mr-1 h-3 w-3" />
                            ) : (
                              <TrendingDown className="mr-1 h-3 w-3" />
                            )}
                            {stock.changePercent >= 0 ? "+" : ""}
                            {stock.changePercent.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300">
                          {formatVolume(stock.volume)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewHistory(stock)}
                            className="bg-white/10 text-white border-white/20 hover:bg-white/20"
                          >
                            <BarChart3 className="mr-2 h-4 w-4" />
                            View History
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* History Dialog */}
        <Dialog open={!!selectedStock} onOpenChange={() => setSelectedStock(null)}>
          <DialogContent className="max-w-4xl bg-slate-900 border-white/20 text-white">
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {selectedStock?.symbol} - {selectedStock?.name}
              </DialogTitle>
              <DialogDescription className="text-slate-300">
                Historical price data (30 days)
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              {loadingHistory ? (
                <div className="text-center py-8 text-slate-300">Loading historical data...</div>
              ) : historicalData.length === 0 ? (
                <div className="text-center py-8 text-slate-300">No historical data available</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-white/10 border-white/20">
                      <CardContent className="pt-4">
                        <div className="text-sm text-slate-300">Current Price</div>
                        <div className="text-xl font-bold text-white">
                          {selectedStock && formatPrice(selectedStock.price)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-white/10 border-white/20">
                      <CardContent className="pt-4">
                        <div className="text-sm text-slate-300">Change</div>
                        <div
                          className={`text-xl font-bold ${
                            selectedStock && selectedStock.changePercent >= 0
                              ? "text-green-400"
                              : "text-red-400"
                          }`}
                        >
                          {selectedStock &&
                            `${selectedStock.changePercent >= 0 ? "+" : ""}${selectedStock.changePercent.toFixed(2)}%`}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-white/10 border-white/20">
                      <CardContent className="pt-4">
                        <div className="text-sm text-slate-300">Volume</div>
                        <div className="text-xl font-bold text-white">
                          {selectedStock && formatVolume(selectedStock.volume)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="bg-white/10 border-white/20">
                      <CardContent className="pt-4">
                        <div className="text-sm text-slate-300">Data Points</div>
                        <div className="text-xl font-bold text-white">
                          {historicalData.length}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <Card className="bg-white/10 border-white/20">
                    <CardContent className="pt-6">
                      <ResponsiveContainer width="100%" height={400}>
                        <AreaChart data={historicalData}>
                          <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="5%"
                                stopColor={
                                  selectedStock && selectedStock.changePercent >= 0
                                    ? "#22c55e"
                                    : "#ef4444"
                                }
                                stopOpacity={0.3}
                              />
                              <stop
                                offset="95%"
                                stopColor={
                                  selectedStock && selectedStock.changePercent >= 0
                                    ? "#22c55e"
                                    : "#ef4444"
                                }
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                          <XAxis
                            dataKey="time"
                            stroke="#94a3b8"
                            tick={{ fill: "#94a3b8" }}
                          />
                          <YAxis
                            stroke="#94a3b8"
                            tick={{ fill: "#94a3b8" }}
                            domain={['dataMin - 5', 'dataMax + 5']}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "rgba(15, 23, 42, 0.9)",
                              border: "1px solid rgba(255, 255, 255, 0.2)",
                              borderRadius: "8px",
                              color: "#fff",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="price"
                            stroke={
                              selectedStock && selectedStock.changePercent >= 0
                                ? "#22c55e"
                                : "#ef4444"
                            }
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorPrice)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

