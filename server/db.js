/**
 * Minimal DB helper for Vercel Postgres with safe fallbacks
 * Supports both Vercel 'sql' and local 'pg' connections
 */

import pg from 'pg';
const { Pool } = pg;

let db = null;

async function initDb() {
  if (db) return db;

  // 1. Try Vercel Postgres (if in Vercel environment)
  if (
    process.env.VERCEL_ENV ||
    (process.env.POSTGRES_URL && !process.env.POSTGRES_URL_NON_POOLING)
  ) {
    try {
      const { sql } = await import('@vercel/postgres');
      db = sql;
      console.log('Initialized Vercel Postgres connection');
      return db;
    } catch (err) {
      console.warn('Failed to load @vercel/postgres, falling back to pg:', err);
    }
  }

  // 2. Try Local Postgres (pg)
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (connectionString) {
    try {
      const pool = new Pool({ connectionString });
      // Wrapper to match Vercel sql.query signature if needed, or just use pool
      db = pool;
      console.log('Initialized local Postgres connection');
      return db;
    } catch (err) {
      console.error('Failed to initialize local Postgres pool:', err);
    }
  }

  return null;
}

export function isDbConfigured() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING
  );
}

export async function ensureSchema() {
  const client = await initDb();
  if (!client) return false;

  // Use slug as primary key to avoid extension requirements
  const query = `
    CREATE TABLE IF NOT EXISTS shared_projects (
      slug TEXT PRIMARY KEY,
      title TEXT,
      data JSONB NOT NULL,
      edit_token TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await client.query(query);
  return true;
}

export async function createOrUpdateProject({ slug, title, data, editToken }) {
  const client = await initDb();
  if (!client) throw new Error('Database not configured');

  const query = `
    INSERT INTO shared_projects (slug, title, data, edit_token)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (slug)
    DO UPDATE SET
      title = EXCLUDED.title,
      data = EXCLUDED.data,
      edit_token = EXCLUDED.edit_token,
      updated_at = NOW();
  `;

  await client.query(query, [slug, title ?? null, data, editToken ?? null]);
  return { slug };
}

export async function getProjectBySlug(slug) {
  const client = await initDb();
  if (!client) throw new Error('Database not configured');

  const query = `
    SELECT slug, title, data, edit_token, created_at, updated_at
    FROM shared_projects
    WHERE slug = $1
    LIMIT 1;
  `;

  const { rows } = await client.query(query, [slug]);
  return rows[0] || null;
}
