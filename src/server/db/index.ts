import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as localDrizzle } from 'drizzle-orm/pglite';
import { resolve } from 'node:path';
export type Database = PgDatabase<any, typeof schema>;
export function createDatabase(url: string) { return drizzle(postgres(url, { max: 5 }), { schema }); }
const globalDb = globalThis as typeof globalThis & {missionCareDb?:Database};
export function getDatabase(): Database {
  if (globalDb.missionCareDb) return globalDb.missionCareDb;
  if (process.env.MC_LOCAL_DB === '1' && process.env.NODE_ENV !== 'production') {
    return globalDb.missionCareDb = localDrizzle(new PGlite(resolve('.local-data/db')),{schema});
  }
  if (!process.env.DATABASE_URL) throw new Error('Database not configured');
  return globalDb.missionCareDb = createDatabase(process.env.DATABASE_URL);
}
