import { Request, Response } from 'express';
import { generateAISignal, type MarketData, type TradingSignal } from '../../services/ai-strategies';
import { storeAISignal, type AISignal } from '../../services/clickhouse';
import { v4 as uuidv4 } from 'uuid';

export async function generateSignalController(req: Request, res: Response) {
  try {
    const { symbol, price, volume, historicalPrices, strategy, sentimentScore } = req.body;

    // Validate required fields
    if (!symbol || price === undefined || !historicalPrices) {
      return res.status(400).json({ 
        error: 'Missing required fields: symbol, price, and historicalPrices are required' 
      });
    }

    const marketData: MarketData = {
      symbol,
      price,
      volume: volume || 0,
      historicalPrices: historicalPrices || [],
      timestamp: Date.now()
    };

    const strategyName = strategy || 'neuro-scalp';
    console.log(`[${new Date().toISOString()}] Generating AI signal for ${symbol} using ${strategyName} strategy`);
    
    const signal = generateAISignal(marketData, strategyName, sentimentScore || 0);
    
    console.log(`[${new Date().toISOString()}] AI signal generated: ${signal.action} with ${signal.confidence.toFixed(1)}% confidence`);
    
    // Store signal in database if confidence > 75% and action is not HOLD
    if (signal.confidence > 75 && signal.action !== 'HOLD') {
      try {
        const aiSignal: AISignal = {
          signalId: uuidv4(),
          timestamp: new Date(),
          symbol,
          strategy: strategyName,
          action: signal.action as 'BUY' | 'SELL',
          confidence: signal.confidence,
          reason: signal.reason,
          price,
          status: 'pending',
        };
        
        await storeAISignal(aiSignal);
        console.log(`[${new Date().toISOString()}] AI signal stored in database for ${symbol}`);
      } catch (storeError) {
        console.error(`[${new Date().toISOString()}] Error storing AI signal:`, storeError);
        // Don't fail the request if storage fails
      }
    }
    
    res.json(signal);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error generating AI signal:`, error);
    res.status(500).json({ error: 'Failed to generate AI signal' });
  }
}

