// Utility functions

export function log(message: string, source: string = 'server') {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  console.log(`${timestamp} [${source}] ${message}`);
}

/**
 * Get current time in a specific timezone
 * Properly handles timezone conversion using Intl API
 */
export function getTimeInTimezone(date: Date, timeZone: string): { day: number; hours: number; minutes: number; date: Date } {
  // Use Intl.DateTimeFormat to get time components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0');
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  
  // Get weekday name and convert to day number
  const weekdayName = parts.find(p => p.type === 'weekday')?.value || '';
  const weekdayMap: Record<string, number> = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
  };
  const dayOfWeek = weekdayMap[weekdayName] ?? 0;
  
  // Create a date object representing the time in the target timezone
  // Note: This is just for reference, actual timezone conversion is handled by Intl API
  const tzDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  
  return { day: dayOfWeek, hours, minutes, date: tzDate };
}

/**
 * Market configuration interface
 */
export interface MarketConfig {
  name: string;
  timeZone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  days: number[]; // Days of week (0 = Sunday, 1 = Monday, etc.)
}

/**
 * Major stock markets configuration
 */
export const MARKETS: Record<string, MarketConfig> = {
  US: {
    name: 'US Stock Market (NYSE/NASDAQ)',
    timeZone: 'America/New_York',
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  LONDON: {
    name: 'London Stock Exchange (LSE)',
    timeZone: 'Europe/London',
    openHour: 8,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 30,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  TOKYO: {
    name: 'Tokyo Stock Exchange (TSE)',
    timeZone: 'Asia/Tokyo',
    openHour: 9,
    openMinute: 0,
    closeHour: 15,
    closeMinute: 0,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  HONG_KONG: {
    name: 'Hong Kong Stock Exchange (HKEX)',
    timeZone: 'Asia/Hong_Kong',
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  FRANKFURT: {
    name: 'Frankfurt Stock Exchange (XETR)',
    timeZone: 'Europe/Berlin',
    openHour: 9,
    openMinute: 0,
    closeHour: 17,
    closeMinute: 30,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  SYDNEY: {
    name: 'Australian Securities Exchange (ASX)',
    timeZone: 'Australia/Sydney',
    openHour: 10,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 0,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  INDIA: {
    name: 'National Stock Exchange of India (NSE/BSE)',
    timeZone: 'Asia/Kolkata',
    openHour: 9,
    openMinute: 15,
    closeHour: 15,
    closeMinute: 30,
    days: [1, 2, 3, 4, 5] // Monday-Friday
  },
  FOREX: {
    name: 'Forex Market (24/5)',
    timeZone: 'UTC',
    openHour: 0,
    openMinute: 0,
    closeHour: 24, // 24 hours (always open during weekdays)
    closeMinute: 0,
    days: [1, 2, 3, 4, 5] // Monday-Friday, 24 hours
  }
};

/**
 * Market Hours Utility
 * Checks if stock markets are currently open
 */
export interface MarketStatus {
  isOpen: boolean;
  nextOpen?: Date;
  nextClose?: Date;
  message: string;
  market?: string;
}

export interface MarketInfo {
  market: string;
  name: string;
  isOpen: boolean;
  currentTime: string;
  timeZone: string;
  nextOpen?: Date;
  nextClose?: Date;
}

/**
 * Check if a specific market is currently open
 */
export function isMarketOpen(market: string = 'US', date: Date = new Date()): boolean {
  const config = MARKETS[market];
  if (!config) {
    // Default to US market
    return isMarketOpen('US', date);
  }
  
  // Special handling for Forex market (24/5)
  if (market === 'FOREX') {
    const tzTime = getTimeInTimezone(date, config.timeZone);
    const day = tzTime.day;
    // Forex is open 24/5 (Monday-Friday, all day)
    return config.days.includes(day);
  }
  
  const tzTime = getTimeInTimezone(date, config.timeZone);
  const day = tzTime.day;
  const hours = tzTime.hours;
  const minutes = tzTime.minutes;
  
  // Check if market is closed on weekends/holidays
  if (!config.days.includes(day)) {
    return false;
  }
  
  // Check market hours
  const currentTime = hours * 60 + minutes;
  const openTime = config.openHour * 60 + config.openMinute;
  const closeTime = config.closeHour * 60 + config.closeMinute;
  
  return currentTime >= openTime && currentTime < closeTime;
}

/**
 * Get detailed market status for a specific market
 */
export function getMarketStatus(market: string = 'US', date: Date = new Date()): MarketStatus {
  const config = MARKETS[market];
  if (!config) {
    return getMarketStatus('US', date);
  }
  
  const tzTime = getTimeInTimezone(date, config.timeZone);
  const isOpen = isMarketOpen(market, date);
  
  const day = tzTime.day;
  const hours = tzTime.hours;
  const minutes = tzTime.minutes;
  
  // Format current time in market timezone
  const currentTimeStr = new Date().toLocaleString('en-US', {
    timeZone: config.timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  if (isOpen) {
    // Calculate next close
    const nextClose = new Date(date);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const parts = formatter.formatToParts(nextClose);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
    const dayNum = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    
    const closeDate = new Date(Date.UTC(year, month, dayNum, config.closeHour, config.closeMinute));
    
    return {
      isOpen: true,
      nextClose: closeDate,
      message: `${config.name} is OPEN (${currentTimeStr} ${config.timeZone.split('/')[1]})`,
      market
    };
  }
  
  // Market is closed - calculate next open
  let daysToAdd = 0;
  let nextOpenDay = day;
  
  // Find next trading day
  while (!config.days.includes(nextOpenDay)) {
    daysToAdd++;
    nextOpenDay = (day + daysToAdd) % 7;
  }
  
  // If it's a trading day but before/after hours
  if (config.days.includes(day)) {
    const currentTime = hours * 60 + minutes;
    const closeTime = config.closeHour * 60 + config.closeMinute;
    
    if (currentTime >= closeTime) {
      // After hours - next open is next trading day
      daysToAdd = 1;
      nextOpenDay = (day + 1) % 7;
      while (!config.days.includes(nextOpenDay)) {
        daysToAdd++;
        nextOpenDay = (day + daysToAdd) % 7;
      }
    } else {
      // Before hours - next open is today
      daysToAdd = 0;
    }
  }
  
  const nextOpenDate = new Date(date);
  nextOpenDate.setDate(nextOpenDate.getDate() + daysToAdd);
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.formatToParts(nextOpenDate);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
  const dayNum = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  
  const openDate = new Date(Date.UTC(year, month, dayNum, config.openHour, config.openMinute));
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const nextDayName = dayNames[nextOpenDay];
  const timeStr = `${config.openHour.toString().padStart(2, '0')}:${config.openMinute.toString().padStart(2, '0')}`;
  
  return {
    isOpen: false,
    nextOpen: openDate,
    message: `${config.name} is CLOSED. Opens ${nextDayName} at ${timeStr} (${config.timeZone.split('/')[1]})`,
    market
  };
}

/**
 * Get status for all markets
 */
export function getAllMarketsStatus(date: Date = new Date()): MarketInfo[] {
  return Object.keys(MARKETS).map(market => {
    const config = MARKETS[market];
    const status = getMarketStatus(market, date);
    const currentTime = new Date().toLocaleString('en-US', {
      timeZone: config.timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return {
      market,
      name: config.name,
      isOpen: status.isOpen,
      currentTime,
      timeZone: config.timeZone,
      nextOpen: status.nextOpen,
      nextClose: status.nextClose
    };
  });
}

/**
 * Get list of markets that are currently open
 */
export function getOpenMarkets(date: Date = new Date()): string[] {
  return Object.keys(MARKETS).filter(market => isMarketOpen(market, date));
}