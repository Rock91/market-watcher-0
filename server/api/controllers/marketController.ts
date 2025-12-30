import { Request, Response } from 'express';
import { getMarketMovers, yahooFinanceInstance } from '../../services/yahooFinance';
import { 
  getLatestMarketMovers, 
  getMarketMoversHistory,
  storeMarketMovers,
  getLatestTrendingSymbols,
  storeTrendingSymbols
} from '../../services/clickhouse';
import { getMarketStatus, getOpenMarkets, getAllMarketsStatus, MARKETS } from '../../utils/helpers';

// Get market movers (gainers or losers)
export async function getMarketMoversController(req: Request, res: Response) {
  const { type } = req.params; // 'gainers' or 'losers'
  const { count = 20 } = req.query;

  try {
    // First, try to get data from ClickHouse
    const cachedMovers = await getLatestMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    if (cachedMovers.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning cached ${type} market movers`);
      // Transform ClickHouse format to expected format
      // Note: change_percent is already a percentage value (e.g., -11.85 for -11.85%)
      const transformedMovers = cachedMovers.map((mover: any) => {
        const changePercent = mover.change_percent || 0;
        // Calculate absolute change from percentage and price
        const change = (mover.price * changePercent) / 100;
        const volume = mover.volume || 0;
        return {
          symbol: mover.symbol,
          name: mover.name,
          price: mover.price,
          change: change, // Absolute change amount
          changePercent: changePercent, // Percentage change
          changeFormatted: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
          vol: volume > 0 ? `${(volume / 1000000).toFixed(1)}M` : 'N/A',
          volume: volume,
          currency: mover.currency || 'USD'
        };
      });
      return res.json(transformedMovers);
    }

    // If not in cache, fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Fetching ${type} market movers from Yahoo Finance, count: ${count}`);
    const newMovers = await getMarketMovers(type as 'gainers' | 'losers', parseInt(count as string));

    // Transform to expected format for frontend
    // Note: changePercent is already a percentage value (e.g., -11.85 for -11.85%)
    const formattedMovers = newMovers.map((mover: any) => {
      const changePercent = mover.changePercent || 0;
      // Calculate absolute change from percentage and price
      const change = (mover.price * changePercent) / 100;
      return {
        symbol: mover.symbol,
        name: mover.name,
        price: mover.price,
        change: change, // Absolute change amount
        changePercent: changePercent, // Percentage change
        changeFormatted: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        vol: mover.volume ? `${(mover.volume / 1000000).toFixed(1)}M` : 'N/A',
        currency: mover.currency || 'USD'
      };
    });

    // Store in ClickHouse for future requests (store original format)
    if (newMovers.length > 0) {
      await storeMarketMovers(type as 'gainers' | 'losers', newMovers);
    }

    console.log(`[${new Date().toISOString()}] Returning ${formattedMovers.length} ${type} results`);
    res.json(formattedMovers);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching market movers:`, error);
    // Fallback to mock data
    const mockGainers = [
      { symbol: "NVDA", name: "NVIDIA Corp", price: 145.32, change: "+12.4%", vol: "45M" },
      { symbol: "AMD", name: "Adv Micro Dev", price: 178.90, change: "+8.2%", vol: "22M" },
      { symbol: "PLTR", name: "Palantir Tech", price: 24.50, change: "+7.8%", vol: "18M" },
    ];
    const mockLosers = [
      { symbol: "INTC", name: "Intel Corp", price: 30.12, change: "-8.4%", vol: "30M" },
      { symbol: "WBA", name: "Walgreens Boots", price: 18.45, change: "-7.2%", vol: "10M" },
      { symbol: "LULU", name: "Lululemon", price: 290.50, change: "-6.8%", vol: "5M" },
    ];
    res.json(type === 'gainers' ? mockGainers : mockLosers);
  }
}

// Get trending symbols - first check DB, then fallback to Yahoo Finance
export async function getTrendingSymbolsController(req: Request, res: Response) {
  const { count = 20 } = req.query;
  console.log(`[${new Date().toISOString()}] Fetching trending symbols, count: ${count}`);

  try {
    // First, try to get trending from ClickHouse (cached from background job)
    const cachedTrending: any = await getLatestTrendingSymbols(parseInt(count as string));

    if (cachedTrending && cachedTrending.length > 0) {
      console.log(`[${new Date().toISOString()}] Returning ${cachedTrending.length} cached trending symbols`);
      const trending = {
        symbols: cachedTrending.map((item: any) => ({
          symbol: item.symbol,
          name: item.name,
          rank: item.rank
        }))
      };
      return res.json(trending);
    }

    // If not in cache, try to fetch from Yahoo Finance
    console.log(`[${new Date().toISOString()}] Cache miss for trending, fetching from Yahoo Finance...`);
    
    try {
      const trendingResult = await yahooFinanceInstance.trendingSymbols('US', { count: parseInt(count as string) });
      
      if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
        // Store in database for future requests
        await storeTrendingSymbols(trendingResult.quotes);
        
        console.log(`[${new Date().toISOString()}] Trending symbols fetched: ${trendingResult.quotes.length} symbols`);
        
        const trending = {
          symbols: trendingResult.quotes.map((quote: any, index: number) => ({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            rank: index + 1
          }))
        };
        return res.json(trending);
      }
    } catch (yahooError) {
      console.warn(`[${new Date().toISOString()}] Yahoo Finance trending API failed, falling back to gainers`);
    }

    // Fallback: use market gainers as trending
    const newMovers = await getMarketMovers('gainers', parseInt(count as string));
    console.log(`[${new Date().toISOString()}] Using gainers as trending: ${newMovers.length} symbols`);

    const trending = {
      symbols: newMovers.map((quote: any, index: number) => ({
        symbol: quote.symbol,
        name: quote.name,
        rank: index + 1
      }))
    };

    res.json(trending);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching trending symbols:`, error);
    res.status(500).json({ error: 'Failed to fetch trending symbols' });
  }
}

// Get historical market movers from ClickHouse
export async function getMarketMoversHistoryController(req: Request, res: Response) {
  try {
    const { type, limit = 100 } = req.query; // type: 'gainers' or 'losers'

    console.log(`[${new Date().toISOString()}] Fetching ClickHouse market movers, type: ${type}, limit ${limit}`);

    const history = await getMarketMoversHistory(type as 'gainers' | 'losers', parseInt(limit as string));

    console.log(`[${new Date().toISOString()}] Retrieved ${history.length} market movers records`);
    res.json(history);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching ClickHouse market movers:`, error);
    res.status(500).json({ error: 'Failed to fetch market movers from ClickHouse' });
  }
}

// Get market status (open/closed)
export async function getMarketStatusController(req: Request, res: Response) {
  try {
    const { market } = req.query;
    const status = market ? getMarketStatus(market as string) : getMarketStatus();
    res.json(status);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting market status:`, error);
    res.status(500).json({ error: 'Failed to get market status' });
  }
}

// Get all markets status
export async function getAllMarketsStatusController(req: Request, res: Response) {
  try {
    const allMarkets = getAllMarketsStatus();
    res.json(allMarkets);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting all markets status:`, error);
    res.status(500).json({ error: 'Failed to get all markets status' });
  }
}

// Get stocks from markets that are currently open
export async function getStocksFromOpenMarketsController(req: Request, res: Response) {
  try {
    const { count = 20 } = req.query;
    const countNum = parseInt(count as string);
    
    console.log(`[${new Date().toISOString()}] Fetching stocks from open markets, count: ${countNum}`);
    
    // Get list of open markets
    const openMarkets = getOpenMarkets();
    
    if (openMarkets.length === 0) {
      return res.json({
        markets: [],
        stocks: [],
        message: 'No markets are currently open'
      });
    }
    
    // Map market codes to Yahoo Finance region codes
    const marketRegionMap: Record<string, string> = {
      'US': 'US',
      'LONDON': 'GB',
      'TOKYO': 'JP',
      'HONG_KONG': 'HK',
      'FRANKFURT': 'DE',
      'SYDNEY': 'AU',
      'INDIA': 'IN',
      'FOREX': 'FX' // Forex doesn't use region codes
    };
    
    // Fetch stocks from each open market
    const stocksPromises = openMarkets.map(async (market) => {
      try {
        const region = marketRegionMap[market] || 'US';
        const marketConfig = MARKETS[market];
        
        // Try to get trending symbols for the region
        let stocks: any[] = [];
        try {
          let trendingResult: any = null;
          
          try {
            // Try with validation disabled for regions that may have schema issues
            trendingResult = await yahooFinanceInstance.trendingSymbols(region, { count: countNum }, { validateResult: false } as any);
          } catch (validationErr: any) {
            // Handle validation errors - data might still be available in error.result
            const errorName = validationErr?.name || validationErr?.constructor?.name || '';
            const isValidationError = errorName.includes('FailedYahooValidationError') || 
                                      errorName.includes('ValidationError') ||
                                      validationErr?.message?.includes('Failed Yahoo Schema validation') ||
                                      validationErr?.message?.includes('Expected an object');
            
            if (isValidationError && validationErr?.result) {
              // Extract data from validation error - data is valid, just schema validation failed
              console.warn(`[${new Date().toISOString()}] Schema validation failed for ${market}, but extracting data from error result`);
              trendingResult = validationErr.result;
            } else {
              // Re-throw if it's not a validation error
              throw validationErr;
            }
          }
          
          if (trendingResult?.quotes && trendingResult.quotes.length > 0) {
            stocks = trendingResult.quotes.map((quote: any, index: number) => ({
              symbol: quote.symbol,
              name: quote.shortName || quote.longName || quote.symbol,
              price: quote.regularMarketPrice || 0,
              change: quote.regularMarketChange || 0,
              changePercent: quote.regularMarketChangePercent || 0,
              volume: quote.regularMarketVolume || 0,
              currency: quote.currency || 'USD',
              market: market,
              marketName: marketConfig.name,
              rank: index + 1
            }));
          }
        } catch (error) {
          console.warn(`[${new Date().toISOString()}] Failed to fetch trending symbols for ${market}, trying market movers...`);
          
          // Fallback to market movers (gainers) for US market
          if (market === 'US') {
            try {
              const movers = await getMarketMovers('gainers', countNum);
              stocks = movers.map((mover: any, index: number) => ({
                symbol: mover.symbol,
                name: mover.name,
                price: mover.price,
                change: (mover.price * mover.changePercent) / 100,
                changePercent: mover.changePercent,
                volume: mover.volume,
                currency: mover.currency || 'USD',
                market: market,
                marketName: marketConfig.name,
                rank: index + 1
              }));
            } catch (moverError) {
              console.error(`[${new Date().toISOString()}] Failed to fetch market movers for ${market}:`, moverError);
            }
          }
        }
        
        return {
          market,
          marketName: marketConfig.name,
          timeZone: marketConfig.timeZone,
          stocks
        };
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching stocks for market ${market}:`, error);
        return {
          market,
          marketName: MARKETS[market]?.name || market,
          timeZone: MARKETS[market]?.timeZone || '',
          stocks: []
        };
      }
    });
    
    const results = await Promise.all(stocksPromises);
    
    // Handle Forex market separately (if open)
    if (openMarkets.includes('FOREX')) {
      try {
        const forexQuotes = await getForexQuotes(MAJOR_FOREX_PAIRS.slice(0, countNum));
        const forexStocks = forexQuotes.map((quote: any, index: number) => ({
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          volume: quote.volume,
          currency: quote.currency || 'USD',
          market: 'FOREX',
          marketName: 'Forex Market (24/5)',
          rank: index + 1,
          marketInfo: {
            market: 'FOREX',
            marketName: 'Forex Market (24/5)',
            timeZone: 'UTC'
          }
        }));
        
        results.push({
          market: 'FOREX',
          marketName: 'Forex Market (24/5)',
          timeZone: 'UTC',
          stocks: forexStocks
        });
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching forex:`, error);
      }
    }
    
    // Flatten all stocks from all open markets
    const allStocks = results.flatMap(result => 
      result.stocks.map((stock: any) => ({
        ...stock,
        marketInfo: {
          market: result.market,
          marketName: result.marketName,
          timeZone: result.timeZone
        }
      }))
    );
    
    // Sort by changePercent (descending) to show biggest movers first
    allStocks.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
    
    // Limit to requested count
    const limitedStocks = allStocks.slice(0, countNum);
    
    console.log(`[${new Date().toISOString()}] Returning ${limitedStocks.length} stocks from ${openMarkets.length} open markets`);
    
    res.json({
      markets: results.map(r => ({
        market: r.market,
        marketName: r.marketName,
        timeZone: r.timeZone,
        stockCount: r.stocks.length
      })),
      stocks: limitedStocks,
      totalStocks: limitedStocks.length,
      openMarkets: openMarkets.length
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching stocks from open markets:`, error);
    res.status(500).json({ error: 'Failed to fetch stocks from open markets' });
  }
}
