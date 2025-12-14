// Advanced AI Trading Strategies
export interface TradingSignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  technicalIndicators: {
    rsi?: number;
    macd?: number;
    bollingerBands?: {
      upper: number;
      middle: number;
      lower: number;
    };
    movingAverages?: {
      sma20: number;
      sma50: number;
      ema12: number;
      ema26: number;
    };
  };
}

export interface MarketData {
  symbol: string;
  price: number;
  volume: number;
  historicalPrices: number[];
  timestamp: number;
}

// Calculate RSI (Relative Strength Index)
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const avgGain = gains.slice(-period).reduce((sum, gain) => sum + gain, 0) / period;
  const avgLoss = losses.slice(-period).reduce((sum, loss) => sum + loss, 0) / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate MACD
export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  // Simplified MACD calculation
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd], 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

// Calculate EMA (Exponential Moving Average)
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

// Calculate Bollinger Bands
export function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number } {
  if (prices.length < period) {
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    return { upper: avg, middle: avg, lower: avg };
  }

  const slice = prices.slice(-period);
  const sma = slice.reduce((sum, price) => sum + price, 0) / period;

  const variance = slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: sma + (stdDev * std),
    middle: sma,
    lower: sma - (stdDev * std)
  };
}

// Neuro-Scalp Strategy (High-frequency trading)
export function neuroScalpStrategy(marketData: MarketData): TradingSignal {
  const { price, historicalPrices } = marketData;
  const recentPrices = historicalPrices.slice(-20);

  const rsi = calculateRSI(recentPrices);
  const macd = calculateMACD(recentPrices);
  const bb = calculateBollingerBands(recentPrices);

  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = '';

  // High-frequency scalp conditions
  if (price < bb.lower && rsi < 30 && macd.histogram > 0) {
    action = 'BUY';
    confidence = Math.min(95, 75 + Math.abs(rsi - 30));
    reason = `Oversold bounce: RSI ${rsi.toFixed(1)}, Price below BB Lower, MACD histogram positive`;
  } else if (price > bb.upper && rsi > 70 && macd.histogram < 0) {
    action = 'SELL';
    confidence = Math.min(95, 75 + Math.abs(rsi - 70));
    reason = `Overbought pullback: RSI ${rsi.toFixed(1)}, Price above BB Upper, MACD histogram negative`;
  } else {
    confidence = 50;
    reason = `Neutral conditions: RSI ${rsi.toFixed(1)}, MACD ${macd.macd.toFixed(3)}`;
  }

  return {
    symbol: marketData.symbol,
    action,
    confidence,
    reason,
    technicalIndicators: {
      rsi,
      macd: macd.macd,
      bollingerBands: bb,
      movingAverages: {
        sma20: bb.middle,
        sma50: calculateEMA(recentPrices, 50),
        ema12: calculateEMA(recentPrices, 12),
        ema26: calculateEMA(recentPrices, 26)
      }
    }
  };
}

// Deep Momentum Strategy (Trend following)
export function deepMomentumStrategy(marketData: MarketData): TradingSignal {
  const { price, historicalPrices } = marketData;
  const recentPrices = historicalPrices.slice(-50);

  const ema20 = calculateEMA(recentPrices, 20);
  const ema50 = calculateEMA(recentPrices, 50);
  const macd = calculateMACD(recentPrices);
  const rsi = calculateRSI(recentPrices);

  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = '';

  // Trend following conditions
  if (price > ema20 && ema20 > ema50 && macd.macd > macd.signal && rsi > 50) {
    action = 'BUY';
    confidence = Math.min(99, 84 + (macd.macd - macd.signal) * 10);
    reason = `Strong uptrend: Price > EMA20 > EMA50, MACD bullish, RSI ${rsi.toFixed(1)}`;
  } else if (price < ema20 && ema20 < ema50 && macd.macd < macd.signal && rsi < 50) {
    action = 'SELL';
    confidence = Math.min(99, 84 + Math.abs(macd.macd - macd.signal) * 10);
    reason = `Strong downtrend: Price < EMA20 < EMA50, MACD bearish, RSI ${rsi.toFixed(1)}`;
  } else {
    confidence = 60;
    reason = `Awaiting trend confirmation: EMA20: ${ema20.toFixed(2)}, EMA50: ${ema50.toFixed(2)}`;
  }

  return {
    symbol: marketData.symbol,
    action,
    confidence,
    reason,
    technicalIndicators: {
      rsi,
      macd: macd.macd,
      movingAverages: {
        sma20: ema20,
        sma50: ema50,
        ema12: calculateEMA(recentPrices, 12),
        ema26: calculateEMA(recentPrices, 26)
      }
    }
  };
}

// Sentiment Flow Strategy (News and social sentiment)
export function sentimentFlowStrategy(marketData: MarketData, sentimentScore: number = 0): TradingSignal {
  const { price, historicalPrices } = marketData;
  const recentPrices = historicalPrices.slice(-20);

  const rsi = calculateRSI(recentPrices);
  const macd = calculateMACD(recentPrices);
  const bb = calculateBollingerBands(recentPrices);

  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = '';

  // Sentiment-based conditions
  if (sentimentScore > 0.7 && price > bb.middle && rsi < 70) {
    action = 'BUY';
    confidence = Math.min(95, 70 + sentimentScore * 25);
    reason = `Positive sentiment spike (${(sentimentScore * 100).toFixed(0)}%): Bullish momentum`;
  } else if (sentimentScore < -0.7 && price < bb.middle && rsi > 30) {
    action = 'SELL';
    confidence = Math.min(95, 70 + Math.abs(sentimentScore) * 25);
    reason = `Negative sentiment spike (${(sentimentScore * 100).toFixed(0)}%): Bearish pressure`;
  } else {
    confidence = 50;
    reason = `Neutral sentiment (${(sentimentScore * 100).toFixed(0)}%): Awaiting catalyst`;
  }

  return {
    symbol: marketData.symbol,
    action,
    confidence,
    reason,
    technicalIndicators: {
      rsi,
      macd: macd.macd,
      bollingerBands: bb
    }
  };
}

// Main strategy selector
export function generateAISignal(marketData: MarketData, strategy: string, sentimentScore: number = 0): TradingSignal {
  switch (strategy) {
    case 'neuro-scalp':
      return neuroScalpStrategy(marketData);
    case 'deep-momentum':
      return deepMomentumStrategy(marketData);
    case 'sentiment-flow':
      return sentimentFlowStrategy(marketData, sentimentScore);
    default:
      return neuroScalpStrategy(marketData);
  }
}