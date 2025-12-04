/**
 * @file Test Database
 * @description Test-specific database instance and utilities
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import path from 'path'
import { Pool } from 'pg'

import * as schema from '@/database/schema'
import {
  closeDb as closeDbUtil,
  dropAll as dropAllUtil,
  migrateDb as migrateDbUtil,
  resetDb as resetDbUtil,
} from '@/database/utils'

// Get database URL from environment
const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aerodrome_test'

// Create database pool
const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
})

// Create database instance
export const db = drizzle(pool, { schema })

export async function resetDb() {
  return resetDbUtil(db, {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg, err) => console.error(msg, err),
  })
}

export async function dropAll() {
  return dropAllUtil(db)
}

export async function migrateDb() {
  const migrationsFolder = path.join(process.cwd(), 'drizzle')
  console.log(`Looking for migrations in: ${migrationsFolder}`)
  return migrateDbUtil(db, pool, migrationsFolder, {
    info: (msg) => console.log(msg),
    error: (msg, err) => console.error(msg, err),
  })
}

export async function closeDb(): Promise<void> {
  return closeDbUtil(pool)
}
