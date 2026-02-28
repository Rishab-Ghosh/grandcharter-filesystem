/**
 * Runs SQL files in packages/db/migrations/ in lexicographic order.
 * Usage: DATABASE_URL=... node dist/migrate.js (after pnpm build)
 */
import { createPool } from './client.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

async function run(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const pool = createPool();
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const path = join(migrationsDir, f);
    const sql = await readFile(path, 'utf-8');
    process.stdout.write(`Running ${f}...\n`);
    await pool.query(sql);
  }
  await pool.end();
  process.stdout.write('Done.\n');
}

run().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
