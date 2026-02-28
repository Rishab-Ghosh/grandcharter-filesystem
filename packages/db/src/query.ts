import type { Pool, QueryResult } from 'pg';

/** Run a parameterized query using the pool. */
export async function query(
  pool: Pool,
  text: string,
  values?: unknown[]
): Promise<QueryResult> {
  return pool.query(text, values);
}
