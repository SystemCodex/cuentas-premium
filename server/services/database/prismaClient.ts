import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';

function normalizeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  const usePooler = process.env.DATABASE_USE_POOLER?.trim().toLowerCase() !== 'false';
  if (!raw) return '';

  try {
    const databaseUrl = new URL(raw);
    const [endpoint, ...domainParts] = databaseUrl.hostname.split('.');
    if (usePooler && databaseUrl.hostname.endsWith('.neon.tech') && endpoint && !endpoint.endsWith('-pooler')) {
      databaseUrl.hostname = [`${endpoint}-pooler`, ...domainParts].join('.');
    }
    if (databaseUrl.hostname.endsWith('.neon.tech') && !databaseUrl.searchParams.has('sslmode')) {
      databaseUrl.searchParams.set('sslmode', 'require');
    }
    if (!databaseUrl.searchParams.has('connect_timeout')) {
      databaseUrl.searchParams.set('connect_timeout', process.env.DATABASE_CONNECT_TIMEOUT_SECONDS || '8');
    }
    if (!databaseUrl.searchParams.has('pool_timeout')) {
      databaseUrl.searchParams.set('pool_timeout', process.env.DATABASE_POOL_TIMEOUT_SECONDS || '8');
    }
    if (!databaseUrl.searchParams.has('connection_limit')) {
      databaseUrl.searchParams.set('connection_limit', process.env.DATABASE_CONNECTION_LIMIT || '5');
    }
    process.env.DATABASE_URL = databaseUrl.toString();
    return process.env.DATABASE_URL;
  } catch {
    return raw;
  }
}

function buildPgAdapterConfig(connectionString: string): { config: pg.PoolConfig; schema: string } {
  const databaseUrl = new URL(connectionString);
  const schema = databaseUrl.searchParams.get('schema') || 'public';
  const sslMode = databaseUrl.searchParams.get('sslmode');
  const connectionLimit = Number(databaseUrl.searchParams.get('connection_limit') || process.env.DATABASE_CONNECTION_LIMIT || 5);
  const connectTimeout = Number(databaseUrl.searchParams.get('connect_timeout') || process.env.DATABASE_CONNECT_TIMEOUT_SECONDS || 8);

  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'channel_binding', 'connect_timeout', 'sslmode']) {
    databaseUrl.searchParams.delete(key);
  }

  return {
    schema,
    config: {
      connectionString: databaseUrl.toString(),
      max: connectionLimit,
      connectionTimeoutMillis: connectTimeout * 1000,
      idleTimeoutMillis: 30_000,
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: true }
    }
  };
}

export function createPrismaClient() {
  const connectionString = normalizeDatabaseUrl();
  const { config, schema } = buildPgAdapterConfig(connectionString);
  const adapter = new PrismaPg(config, {
    schema,
    onPoolError(error) {
      console.error('[database:pool]', error.message);
    },
    onConnectionError(error) {
      console.error('[database:connection]', error.message);
    }
  });
  return new PrismaClient({ adapter });
}

export function getRuntimeDatabaseHost() {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    return '';
  }
}
