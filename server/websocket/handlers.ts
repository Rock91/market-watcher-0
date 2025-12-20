import { 
  ExtendedWebSocket, 
  SubscribeMessage, 
  UnsubscribeMessage,
  RequestAISignalMessage,
  RequestHistoricalMessage,
  ConnectionStatusMessage,
  ErrorMessage,
  AISignalMessage,
  HistoricalUpdateMessage,
  WebSocketEventType
} from './types';
import { generateAISignal, type MarketData } from '../services/ai-strategies';
import { storeAISignal, type AISignal } from '../services/clickhouse';
import { v4 as uuidv4 } from 'uuid';
import { getHistoricalData } from '../services/yahooFinance';
import { getStockHistory, getHistoricalData as getDbHistoricalData } from '../services/clickhouse';
import { v4 as uuidv4 } from 'uuid';

// Generate unique client ID
function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Handle WebSocket connection
export function handleConnection(ws: ExtendedWebSocket, clients: Set<ExtendedWebSocket>) {
  // Assign unique client ID
  ws.clientId = generateClientId();
  ws.symbols = [];
  ws.subscribedEvents = ['price_update', 'market_movers_update']; // Default subscriptions
  ws.lastActivity = Date.now();

  console.log(`[${new Date().toISOString()}] Client connected: ${ws.clientId}`);
  clients.add(ws);

  // Send connection status
  const statusMessage: ConnectionStatusMessage = {
    type: 'connection_status',
    status: 'connected',
    clientId: ws.clientId,
    subscribedSymbols: ws.symbols,
    subscribedEvents: ws.subscribedEvents,
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(statusMessage));

  // Handle incoming messages
  ws.on('message', async (message) => {
    ws.lastActivity = Date.now();
    
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'subscribe':
          handleSubscribe(ws, data as SubscribeMessage);
          break;
        case 'unsubscribe':
          handleUnsubscribe(ws, data as UnsubscribeMessage);
          break;
        case 'request_ai_signal':
          await handleAISignalRequest(ws, data as RequestAISignalMessage);
          break;
        case 'request_historical':
          await handleHistoricalRequest(ws, data as RequestHistoricalMessage);
          break;
        default:
          sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] WebSocket message error:`, error);
      sendError(ws, 'PARSE_ERROR', 'Failed to parse message');
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${ws.clientId}`);
    clients.delete(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] WebSocket error for ${ws.clientId}:`, error);
    clients.delete(ws);
  });
}

// Handle subscribe message
function handleSubscribe(ws: ExtendedWebSocket, data: SubscribeMessage) {
  if (data.symbols && data.symbols.length > 0) {
    // Add new symbols (avoid duplicates)
    const newSymbols = data.symbols.filter(s => !ws.symbols?.includes(s));
    ws.symbols = [...(ws.symbols || []), ...newSymbols];
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} subscribed to symbols: ${newSymbols.join(', ')}`);
  }

  if (data.events && data.events.length > 0) {
    // Add new events (avoid duplicates)
    const newEvents = data.events.filter(e => !ws.subscribedEvents?.includes(e));
    ws.subscribedEvents = [...(ws.subscribedEvents || []), ...newEvents];
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} subscribed to events: ${newEvents.join(', ')}`);
  }

  // Send updated connection status
  const statusMessage: ConnectionStatusMessage = {
    type: 'connection_status',
    status: 'connected',
    clientId: ws.clientId || '',
    subscribedSymbols: ws.symbols || [],
    subscribedEvents: ws.subscribedEvents || [],
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(statusMessage));
}

// Handle unsubscribe message
function handleUnsubscribe(ws: ExtendedWebSocket, data: UnsubscribeMessage) {
  if (data.symbols && data.symbols.length > 0) {
    ws.symbols = (ws.symbols || []).filter(s => !data.symbols?.includes(s));
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} unsubscribed from symbols: ${data.symbols.join(', ')}`);
  }

  if (data.events && data.events.length > 0) {
    ws.subscribedEvents = (ws.subscribedEvents || []).filter(e => !data.events?.includes(e));
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} unsubscribed from events: ${data.events.join(', ')}`);
  }

  // Send updated connection status
  const statusMessage: ConnectionStatusMessage = {
    type: 'connection_status',
    status: 'connected',
    clientId: ws.clientId || '',
    subscribedSymbols: ws.symbols || [],
    subscribedEvents: ws.subscribedEvents || [],
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(statusMessage));
}

// Handle AI signal request
async function handleAISignalRequest(ws: ExtendedWebSocket, data: RequestAISignalMessage) {
  const { symbol, strategy = 'neuro-scalp' } = data;

  try {
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} requested AI signal for ${symbol}`);

    // Get historical prices for analysis
    const historicalData = await getDbHistoricalData(symbol, 30);
    let historicalPrices: number[] = [];
    let currentPrice = 100; // Default price

    if (historicalData && Array.isArray(historicalData) && historicalData.length > 0) {
      historicalPrices = historicalData.map((d: any) => d.close || d.price || 0);
      currentPrice = historicalPrices[historicalPrices.length - 1] || 100;
    } else {
      // Fallback: try Yahoo Finance
      try {
        const yahooData = await getHistoricalData(symbol, undefined, undefined, '1d');
        if (yahooData && yahooData.length > 0) {
          historicalPrices = yahooData.map((d: any) => d.close || 0);
          currentPrice = historicalPrices[historicalPrices.length - 1] || 100;
        }
      } catch (err) {
        // Use mock data
        historicalPrices = Array.from({ length: 30 }, () => 100 + (Math.random() - 0.5) * 20);
        currentPrice = historicalPrices[historicalPrices.length - 1];
      }
    }

    // Generate AI signal
    const marketData: MarketData = {
      symbol,
      price: currentPrice,
      volume: 1000000,
      historicalPrices,
      timestamp: Date.now()
    };

    const signal = generateAISignal(marketData, strategy, 0);

    // Calculate price targets
    const volatility = calculateVolatility(historicalPrices);
    const priceTarget = {
      entry: currentPrice,
      stopLoss: signal.action === 'BUY' 
        ? currentPrice * (1 - volatility * 2)
        : currentPrice * (1 + volatility * 2),
      takeProfit: signal.action === 'BUY'
        ? currentPrice * (1 + volatility * 3)
        : currentPrice * (1 - volatility * 3)
    };

    // Store signal in database if confidence > 75% and action is not HOLD
    if (signal.confidence > 75 && signal.action !== 'HOLD') {
      try {
        const aiSignal: AISignal = {
          signalId: uuidv4(),
          timestamp: new Date(),
          symbol,
          strategy,
          action: signal.action as 'BUY' | 'SELL',
          confidence: signal.confidence,
          reason: signal.reason,
          price: currentPrice,
          status: 'pending',
        };
        
        await storeAISignal(aiSignal);
        console.log(`[${new Date().toISOString()}] AI signal stored in database for ${symbol}`);
      } catch (storeError) {
        console.error(`[${new Date().toISOString()}] Error storing AI signal:`, storeError);
        // Don't fail the request if storage fails
      }
    }

    const aiSignalMessage: AISignalMessage = {
      type: 'ai_signal',
      signal: {
        symbol,
        action: signal.action,
        confidence: signal.confidence,
        reason: signal.reason,
        strategy,
        indicators: {
          rsi: signal.technicalIndicators?.rsi,
          macd: signal.technicalIndicators?.macd ? { value: signal.technicalIndicators.macd, signal: 0, histogram: 0 } : undefined,
          sma20: signal.technicalIndicators?.movingAverages?.sma20,
          sma50: signal.technicalIndicators?.movingAverages?.sma50,
        },
        priceTarget
      },
      timestamp: Date.now()
    };

    ws.send(JSON.stringify(aiSignalMessage));
    console.log(`[${new Date().toISOString()}] AI signal sent for ${symbol}: ${signal.action} (${signal.confidence.toFixed(1)}%)`);

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error generating AI signal for ${symbol}:`, error);
    sendError(ws, 'AI_SIGNAL_ERROR', `Failed to generate AI signal for ${symbol}: ${error.message}`);
  }
}

// Handle historical data request
async function handleHistoricalRequest(ws: ExtendedWebSocket, data: RequestHistoricalMessage) {
  const { symbol, days = 30 } = data;

  try {
    console.log(`[${new Date().toISOString()}] Client ${ws.clientId} requested historical data for ${symbol}`);

    // First try database
    let historicalData = await getDbHistoricalData(symbol, days);

    if (!historicalData || !Array.isArray(historicalData) || historicalData.length === 0) {
      // Fallback to Yahoo Finance
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - days);
      
      const yahooData = await getHistoricalData(symbol, startDate, endDate, '1d');
      historicalData = yahooData || [];
    }

    const formattedData = (historicalData as any[]).map((item: any) => ({
      date: item.date || new Date().toISOString(),
      open: item.open || 0,
      high: item.high || 0,
      low: item.low || 0,
      close: item.close || 0,
      volume: item.volume || 0
    }));

    const historicalMessage: HistoricalUpdateMessage = {
      type: 'historical_update',
      symbol,
      data: formattedData,
      interval: '1d',
      timestamp: Date.now()
    };

    ws.send(JSON.stringify(historicalMessage));
    console.log(`[${new Date().toISOString()}] Historical data sent for ${symbol}: ${formattedData.length} records`);

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error fetching historical data for ${symbol}:`, error);
    sendError(ws, 'HISTORICAL_ERROR', `Failed to fetch historical data for ${symbol}: ${error.message}`);
  }
}

// Send error message
function sendError(ws: ExtendedWebSocket, code: string, message: string) {
  const errorMessage: ErrorMessage = {
    type: 'error',
    code,
    message,
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(errorMessage));
}

// Calculate volatility from prices
function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0.02;
  
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  
  if (returns.length === 0) return 0.02;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  
  return Math.sqrt(variance) || 0.02;
}

// Check if client is subscribed to an event
export function isSubscribedToEvent(ws: ExtendedWebSocket, event: WebSocketEventType): boolean {
  return ws.subscribedEvents?.includes(event) || false;
}

// Check if client is subscribed to a symbol
export function isSubscribedToSymbol(ws: ExtendedWebSocket, symbol: string): boolean {
  return !ws.symbols || ws.symbols.length === 0 || ws.symbols.includes(symbol);
}
