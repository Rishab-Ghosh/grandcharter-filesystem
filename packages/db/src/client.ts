import { Pool } from 'pg';

// Connection pool — schema and migrations to be added later
export function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'],
    max: 10,
  });
}
