// Technical Indicators Service
// Provides RSI, MACD, and Volatility calculations for stock analysis

export interface TechnicalIndicators {
  rsi: number;
  macd: {
    value: number;
    signal: number;
    histogram: number;
  };
  volatility: number;
  volatilityPercent: number;
}

/**
 * Calculate RSI (Relative Strength Index)
 * RSI ranges from 0 to 100
 * - Above 70: Overbought (potential sell signal)
 * - Below 30: Oversold (potential buy signal)
 * - Default period: 14 days
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    // Not enough data, return neutral value
    return 50;
  }

  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Use only the last 'period' values
  const recentGains = gains.slice(-period);
  const recentLosses = losses.slice(-period);

  // Calculate average gain and loss
  const avgGain = recentGains.reduce((sum, gain) => sum + gain, 0) / period;
  const avgLoss = recentLosses.reduce((sum, loss) => sum + loss, 0) / period;

  // Avoid division by zero
  if (avgLoss === 0) {
    return 100; // All gains, no losses
  }

  // Calculate RS and RSI
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  // Clamp between 0 and 100
  return Math.max(0, Math.min(100, rsi));
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    // Not enough data, return simple average
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  const multiplier = 2 / (period + 1);
  
  // Start with SMA of first period values
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * Returns MACD line, signal line, and histogram
 * - MACD = EMA(12) - EMA(26)
 * - Signal = EMA(9) of MACD
 * - Histogram = MACD - Signal
 */
export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 26) {
    // Not enough data for proper MACD calculation
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Calculate EMAs
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  // MACD line
  const macd = ema12 - ema26;

  // For signal line, we need MACD values over time
  // Since we only have the current MACD, we'll use a simplified approach
  // In a real implementation, you'd track MACD values over time
  const macdValues: number[] = [];
  
  // Calculate MACD for last 9 periods to get signal line
  for (let i = Math.max(26, prices.length - 9); i < prices.length; i++) {
    const periodPrices = prices.slice(0, i + 1);
    const periodEma12 = calculateEMA(periodPrices, 12);
    const periodEma26 = calculateEMA(periodPrices, 26);
    macdValues.push(periodEma12 - periodEma26);
  }

  // Signal line is EMA(9) of MACD values
  const signal = macdValues.length >= 9 
    ? calculateEMA(macdValues, 9)
    : macdValues.length > 0
    ? macdValues.reduce((sum, val) => sum + val, 0) / macdValues.length
    : macd;

  // Histogram
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Calculate Volatility (Standard Deviation of Returns)
 * Returns both absolute volatility and percentage volatility
 */
export function calculateVolatility(prices: number[], period: number = 20): { volatility: number; volatilityPercent: number } {
  if (prices.length < 2) {
    return { volatility: 0, volatilityPercent: 0 };
  }

  // Use last 'period' prices, or all if less than period
  const recentPrices = prices.slice(-period);
  
  // Calculate returns (percentage changes)
  const returns: number[] = [];
  for (let i = 1; i < recentPrices.length; i++) {
    if (recentPrices[i - 1] > 0) {
      const returnValue = (recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1];
      returns.push(returnValue);
    }
  }

  if (returns.length === 0) {
    return { volatility: 0, volatilityPercent: 0 };
  }

  // Calculate mean return
  const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

  // Calculate variance
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;

  // Standard deviation (volatility)
  const volatility = Math.sqrt(variance);

  // Convert to percentage
  const volatilityPercent = volatility * 100;

  // Annualized volatility (assuming daily data)
  // const annualizedVolatility = volatility * Math.sqrt(252); // 252 trading days per year

  return { volatility, volatilityPercent };
}

/**
 * Calculate all technical indicators for a given price series
 */
export function calculateAllIndicators(prices: number[]): TechnicalIndicators {
  if (prices.length === 0) {
    return {
      rsi: 50,
      macd: { value: 0, signal: 0, histogram: 0 },
      volatility: 0,
      volatilityPercent: 0
    };
  }

  const rsi = calculateRSI(prices, 14);
  const macd = calculateMACD(prices);
  const volatility = calculateVolatility(prices, 20);

  return {
    rsi,
    macd: {
      value: macd.macd,
      signal: macd.signal,
      histogram: macd.histogram
    },
    volatility: volatility.volatility,
    volatilityPercent: volatility.volatilityPercent
  };
}

/**
 * Get volatility level description
 */
export function getVolatilityLevel(volatilityPercent: number): 'Low' | 'Medium' | 'High' {
  if (volatilityPercent < 1) return 'Low';
  if (volatilityPercent < 3) return 'Medium';
  return 'High';
}

/**
 * Get RSI level description
 */
export function getRSILevel(rsi: number): 'Oversold' | 'Neutral' | 'Overbought' {
  if (rsi < 30) return 'Oversold';
  if (rsi > 70) return 'Overbought';
  return 'Neutral';
}
