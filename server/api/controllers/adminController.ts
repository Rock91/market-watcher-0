import type { Request, Response } from 'express';
import { clickhouseClient } from '../../services/clickhouse';
import { CLICKHOUSE_CONFIG } from '../../config/database';

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
        AND name IN ('stock_quotes','market_movers','historical_data','trending_symbols','stock_metadata')
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


