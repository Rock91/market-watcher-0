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
 * Market Hours Utility
 * Checks if the US stock market is currently open
 * Market hours: Monday-Friday, 9:30 AM - 4:00 PM ET
 */
export interface MarketStatus {
  isOpen: boolean;
  nextOpen?: Date;
  nextClose?: Date;
  message: string;
}

/**
 * Check if the US stock market is currently open
 * Market hours: Monday-Friday, 9:30 AM - 4:00 PM ET (Eastern Time)
 */
export function isMarketOpen(date: Date = new Date()): boolean {
  // Convert to Eastern Time
  const etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  const day = etDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = etDate.getHours();
  const minutes = etDate.getMinutes();
  
  // Market is closed on weekends
  if (day === 0 || day === 6) {
    return false;
  }
  
  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9;
  const marketOpenMinutes = 30;
  const marketClose = 16;
  const marketCloseMinutes = 0;
  
  const currentTime = hours * 60 + minutes;
  const openTime = marketOpen * 60 + marketOpenMinutes; // 9:30 AM = 570 minutes
  const closeTime = marketClose * 60 + marketCloseMinutes; // 4:00 PM = 960 minutes
  
  return currentTime >= openTime && currentTime < closeTime;
}

/**
 * Get detailed market status including next open/close times
 */
export function getMarketStatus(date: Date = new Date()): MarketStatus {
  const etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const isOpen = isMarketOpen(date);
  
  const day = etDate.getDay();
  const hours = etDate.getHours();
  const minutes = etDate.getMinutes();
  
  // If market is open
  if (isOpen) {
    // Calculate next close (4:00 PM ET today)
    const nextClose = new Date(etDate);
    nextClose.setHours(16, 0, 0, 0);
    // Convert back to local time for display
    const nextCloseLocal = new Date(nextClose.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    return {
      isOpen: true,
      nextClose: nextCloseLocal,
      message: 'Market is OPEN'
    };
  }
  
  // Market is closed - calculate next open
  let nextOpen = new Date(etDate);
  
  // If it's after 4 PM on a weekday, next open is tomorrow at 9:30 AM
  if (day >= 1 && day <= 5 && (hours >= 16 || (hours === 16 && minutes >= 0))) {
    nextOpen.setDate(nextOpen.getDate() + 1);
    nextOpen.setHours(9, 30, 0, 0);
  }
  // If it's before 9:30 AM on a weekday, next open is today at 9:30 AM
  else if (day >= 1 && day <= 5 && (hours < 9 || (hours === 9 && minutes < 30))) {
    nextOpen.setHours(9, 30, 0, 0);
  }
  // If it's Friday after 4 PM or weekend, next open is Monday at 9:30 AM
  else {
    const daysUntilMonday = day === 0 ? 1 : day === 6 ? 2 : 7 - day + 1;
    nextOpen.setDate(nextOpen.getDate() + daysUntilMonday);
    nextOpen.setHours(9, 30, 0, 0);
  }
  
  // Convert back to local time for display
  const nextOpenLocal = new Date(nextOpen.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const nextDayName = dayNames[nextOpen.getDay()];
  const timeStr = nextOpen.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  
  return {
    isOpen: false,
    nextOpen: nextOpenLocal,
    message: `Market is CLOSED. Opens ${nextDayName} at ${timeStr} ET`
  };
}