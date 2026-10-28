import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected Postgres pool error'));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
