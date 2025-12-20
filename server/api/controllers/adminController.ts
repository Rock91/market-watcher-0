import type { Request, Response } from 'express';
import { clickhouseClient } from '../../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../../config/database';
import { getScriptExecutionHistory, getLatestScriptExecution } from '../../services/clickhouse';

async function timedJsonQuery(query: string, query_params?: Record<string, any>) {
  const startedAt = Date.now();
  const result = await clickhouseClient.query({
    query,
    query_params,
    format: 'JSONEachRow',
  });
  const rows: any = await result.json();
  return { ms: Date.now() - startedAt, rows };
}

export async function getClickhouseHealthController(_req: Request, res: Response) {
  try {
    const pingStarted = Date.now();
    await clickhouseClient.ping();
    const pingMs = Date.now() - pingStarted;

    const version = await timedJsonQuery(`SELECT version() AS version`);

    // Approx row counts (fast) from system.tables; for small DBs you can still use count()
    const tableStats = await timedJsonQuery(
      `
      SELECT
        name,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = {db:String}
        AND name IN ('stock_quotes','market_movers','historical_data','trending_symbols','tracked_symbols','stock_metadata')
      ORDER BY name
      `,
      { db: CLICKHOUSE_CONFIG.database },
    );

    // Latest timestamps / dates
    const latest = await timedJsonQuery(
      `
      SELECT
        (SELECT max(timestamp) FROM ${CLICKHOUSE_CONFIG.database}.stock_quotes) AS stock_quotes_max_ts,
        (SELECT max(timestamp) FROM ${CLICKHOUSE_CONFIG.database}.market_movers) AS market_movers_max_ts,
        (SELECT max(timestamp) FROM ${CLICKHOUSE_CONFIG.database}.trending_symbols) AS trending_max_ts,
        (SELECT max(last_seen) FROM ${CLICKHOUSE_CONFIG.database}.tracked_symbols) AS tracked_symbols_max_ts,
        (SELECT max(date) FROM ${CLICKHOUSE_CONFIG.database}.historical_data) AS historical_max_date
      `,
    );

    res.json({
      ok: true,
      clickhouse: {
        url: `${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}`,
        database: CLICKHOUSE_CONFIG.database,
      },
      timings: {
        pingMs,
        versionMs: version.ms,
        tableStatsMs: tableStats.ms,
        latestMs: latest.ms,
      },
      version: version.rows?.[0]?.version,
      tables: tableStats.rows,
      latest: latest.rows?.[0] || {},
    });
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      error: error?.message || String(error),
      clickhouse: {
        url: `${CLICKHOUSE_CONFIG.host}:${CLICKHOUSE_CONFIG.port}`,
        database: CLICKHOUSE_CONFIG.database,
      },
    });
  }
}

// Get script execution history
export async function getScriptExecutionHistoryController(req: Request, res: Response) {
  try {
    const { script_name, limit } = req.query;
    const history = await getScriptExecutionHistory(
      script_name as string | undefined,
      limit ? parseInt(limit as string, 10) : 50
    );

    res.json({
      ok: true,
      count: history.length,
      scripts: history,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}

// Get latest script execution for a specific script
export async function getLatestScriptExecutionController(req: Request, res: Response) {
  try {
    const { script_name } = req.params;
    if (!script_name) {
      return res.status(400).json({
        ok: false,
        error: 'script_name parameter is required',
      });
    }

    const latest = await getLatestScriptExecution(script_name);
    if (!latest) {
      return res.status(404).json({
        ok: false,
        error: `No execution history found for script: ${script_name}`,
      });
    }

    res.json({
      ok: true,
      script: latest,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}

