import { Request, Response } from 'express';
import { generateAISignal, type MarketData } from '../../services/ai-strategies';

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

    console.log(`[${new Date().toISOString()}] Generating AI signal for ${symbol} using ${strategy || 'neuro-scalp'} strategy`);
    
    const signal = generateAISignal(marketData, strategy || 'neuro-scalp', sentimentScore || 0);
    
    console.log(`[${new Date().toISOString()}] AI signal generated: ${signal.action} with ${signal.confidence.toFixed(1)}% confidence`);
    
    res.json(signal);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error generating AI signal:`, error);
    res.status(500).json({ error: 'Failed to generate AI signal' });
  }
}

