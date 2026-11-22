import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';
export type Database = PgDatabase<any, typeof schema>;
export function createDatabase(url: string) { return drizzle(postgres(url, { max: 5 }), { schema }); }
let instance: Database | undefined;
export function getDatabase(): Database { if (!process.env.DATABASE_URL) throw new Error('Database not configured'); return instance ??= createDatabase(process.env.DATABASE_URL); }
