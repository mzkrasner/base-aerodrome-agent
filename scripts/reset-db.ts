/**
 * Database Reset Script
 * Drops all schemas and re-runs migrations for a clean slate.
 * Schema-agnostic - works regardless of table changes.
 */
import * as dotenv from 'dotenv'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'path'
import { Pool } from 'pg'

import schema from '../src/database/schema/index.js'

// Load env vars
dotenv.config({ path: '.env' })

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined')
  }

  console.log('⚠️  NUCLEAR RESET: Dropping all data and schemas...')

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    // 1. Drop everything
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS public CASCADE`))
      await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS drizzle CASCADE`))
      await tx.execute(sql.raw(`CREATE SCHEMA public`))
    })
    console.log('✅ Schemas dropped.')

    // 2. Re-run migrations
    console.log('🔄 Running migrations...')

    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    })

    console.log('✅ Database reset complete. All tables are empty and fresh.')
  } catch (error) {
    console.error('❌ Reset failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
    process.exit(0)
  }
}

void run()

