/**
 * Trade Controller
 * 
 * Handles trade storage and retrieval
 */

import { Request, Response } from 'express';
import { storeTrade, getOpenTrades, clickhouseClient } from '../../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface TradeRequest {
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity?: number;
  amount: number;
  confidence: number;
  strategy?: string;
  reason?: string;
  signalId?: string;
}

export interface TradeResponse {
  tradeId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  amount: number;
  profit?: number;
  time: string;
  status: string;
}

/**
 * Store a trade in the database
 */
export async function storeTradeController(req: Request, res: Response) {
  try {
    const { symbol, action, price, quantity, amount, confidence, strategy, reason, signalId }: TradeRequest = req.body;

    // Validate required fields
    if (!symbol || !action || price === undefined || amount === undefined || confidence === undefined) {
      return res.status(400).json({ error: 'Missing required fields: symbol, action, price, amount, and confidence are required' });
    }

    // Calculate quantity if not provided
    const calculatedQuantity = quantity || Math.floor(amount / price);

    const tradeId = uuidv4();
    const timestamp = new Date();

    const trade = {
      tradeId,
      signalId: signalId || null,
      timestamp,
      symbol,
      action,
      strategy: strategy || 'dashboard',
      entryPrice: price,
      quantity: calculatedQuantity,
      investmentAmount: amount,
      confidence,
      exitPrice: null,
      exitTimestamp: null,
      profitLoss: null,
      profitLossPercent: null,
      status: 'open',
      reason: reason || `Dashboard trade with ${confidence.toFixed(1)}% confidence`,
    };

    await storeTrade(trade);

    console.log(`[${new Date().toISOString()}] Stored trade: ${symbol} ${action} @ ${price.toFixed(2)}, Amount: ${amount.toFixed(2)}`);

    res.json({
      tradeId,
      symbol,
      action,
      price,
      quantity: calculatedQuantity,
      amount,
      time: timestamp.toISOString(),
      status: 'open'
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error storing trade:`, error);
    res.status(500).json({ error: 'Failed to store trade', details: error.message });
  }
}

/**
 * Get trades from the database
 */
export async function getTradesController(req: Request, res: Response) {
  try {
    const { symbol, status, limit = 50 } = req.query;

    let query = `
      SELECT 
        trade_id,
        signal_id,
        timestamp,
        symbol,
        action,
        strategy,
        entry_price,
        quantity,
        investment_amount,
        confidence,
        exit_price,
        exit_timestamp,
        profit_loss,
        profit_loss_percent,
        status,
        reason
      FROM ${CLICKHOUSE_CONFIG.database}.trade_history
      WHERE 1=1
    `;

    const queryParams: any = { limit: parseInt(limit as string) };

    if (symbol) {
      query += ` AND symbol = {symbol:String}`;
      queryParams.symbol = symbol;
    }

    if (status) {
      query += ` AND status = {status:String}`;
      queryParams.status = status;
    }

    query += ` ORDER BY timestamp DESC LIMIT {limit:UInt32}`;

    const result = await clickhouseClient.query({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const data: any = await result.json();

    const trades: TradeResponse[] = data.map((row: any) => ({
      tradeId: row.trade_id,
      symbol: row.symbol,
      action: row.action,
      price: Number(row.entry_price),
      quantity: Number(row.quantity),
      amount: Number(row.investment_amount),
      profit: row.profit_loss ? Number(row.profit_loss) : undefined,
      time: new Date(row.timestamp).toISOString(),
      status: row.status,
      confidence: Number(row.confidence),
      strategy: row.strategy,
    }));

    res.json(trades);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error getting trades:`, error);
    res.status(500).json({ error: 'Failed to get trades', details: error.message });
  }
}

/**
 * Get recent trades (last 24 hours)
 */
export async function getRecentTradesController(req: Request, res: Response) {
  try {
    const { limit = 50 } = req.query;

    const result = await clickhouseClient.query({
      query: `
        SELECT 
          trade_id,
          signal_id,
          timestamp,
          symbol,
          action,
          strategy,
          entry_price,
          quantity,
          investment_amount,
          confidence,
          exit_price,
          exit_timestamp,
          profit_loss,
          profit_loss_percent,
          status,
          reason
        FROM ${CLICKHOUSE_CONFIG.database}.trade_history
        WHERE timestamp >= now() - INTERVAL 24 HOUR
        ORDER BY timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { limit: parseInt(limit as string) },
      format: 'JSONEachRow',
    });

    const data: any = await result.json();

    const trades: TradeResponse[] = data.map((row: any) => ({
      tradeId: row.trade_id,
      symbol: row.symbol,
      action: row.action,
      price: Number(row.entry_price),
      quantity: Number(row.quantity),
      amount: Number(row.investment_amount),
      profit: row.profit_loss ? Number(row.profit_loss) : undefined,
      time: new Date(row.timestamp).toISOString(),
      status: row.status,
      confidence: Number(row.confidence),
      strategy: row.strategy,
    }));

    res.json(trades);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error getting recent trades:`, error);
    res.status(500).json({ error: 'Failed to get recent trades', details: error.message });
  }
}
