/**
 * OPTIONAL Postgres access — not used by any page in the Phase 4 MVP.
 *
 * The default runtime path in lib/data.ts reads the pipeline's JSON/YAML export
 * files, so the site renders with zero infrastructure. This module is provided so
 * a future deployment can switch to Postgres without touching the pages.
 *
 * It is intentionally written so that it compiles and lints even before
 * `prisma generate` has ever run:
 *   - nothing imports it (so bundlers never even reach it),
 *   - the client is loaded through a non-literal specifier, which avoids a
 *     TypeScript "cannot find module '@prisma/client'" error on a fresh clone,
 *   - every failure path returns null instead of throwing.
 */

/** The subset of PrismaClient this project would use. */
export interface MinimalPrismaClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  [model: string]: unknown;
}

interface PrismaModule {
  PrismaClient?: new (options?: unknown) => MinimalPrismaClient;
  default?: { PrismaClient?: new (options?: unknown) => MinimalPrismaClient };
}

let client: MinimalPrismaClient | null = null;
let attempted = false;

/** True when DATABASE_URL is configured, i.e. the Postgres path is switched on. */
export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

/**
 * Returns a connected client, or null when no database is configured / the
 * Prisma client has not been generated. Reuses one connection per process.
 */
export async function getPrisma(): Promise<MinimalPrismaClient | null> {
  if (!isDatabaseConfigured()) return null;
  if (client) return client;
  if (attempted) return null;
  attempted = true;

  try {
    // Non-literal specifier: keeps `@prisma/client` optional for type-checking and
    // keeps webpack from emitting a "critical dependency" warning.
    const specifier = '@prisma/client';
    const mod = (await import(/* webpackIgnore: true */ specifier)) as PrismaModule;
    const PrismaClientCtor = mod.PrismaClient ?? mod.default?.PrismaClient;
    if (!PrismaClientCtor) return null;
    const instance = new PrismaClientCtor({ log: ['warn', 'error'] });
    await instance.$connect();
    client = instance;
    return client;
  } catch (error) {
    console.warn('[yuri-db] Postgres path unavailable, staying on the JSON path:', error);
    return null;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  try {
    await client.$disconnect();
  } finally {
    client = null;
  }
}
