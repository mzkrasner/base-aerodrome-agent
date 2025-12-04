/**
 * @file Database Utilities
 * @description Utility functions for database operations
 */
import { sql } from 'drizzle-orm'
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { reset } from 'drizzle-seed'
import type { Pool } from 'pg'

import * as schema from './schema'

/**
 * Run database migrations with distributed lock coordination
 */
export async function migrateDb(
  db: NodePgDatabase<typeof schema>,
  pool: Pool,
  migrationsFolder: string,
  logger?: {
    info?: (message: string | object) => void
    error?: (message: string, error?: unknown) => void
  }
): Promise<void> {
  const MIGRATION_LOCK_ID = 77
  const MAX_WAIT_TIME = '5min'

  try {
    await db.execute(sql.raw(`SET lock_timeout = '${MAX_WAIT_TIME}'`))

    const message = 'Acquiring migration lock...'
    if (logger?.info) {
      logger.info(message)
    } else {
      console.log(message)
    }
    await db.execute(sql.raw(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`))

    try {
      const acquiredMessage = 'Acquired migration lock, running migrations...'
      if (logger?.info) {
        logger.info(acquiredMessage)
      } else {
        console.log(acquiredMessage)
      }

      const migrationDb = drizzle({
        client: pool,
        schema,
        ...(logger?.info && {
          logger: {
            logQuery: (query: string) => {
              logger.info?.({
                type: 'migration',
                query: query.substring(0, 200),
                ...(query.length > 200 ? { queryTruncated: true } : {}),
              })
            },
          },
        }),
      })

      await migrate(migrationDb, {
        migrationsFolder,
      })

      const successMessage = 'Migrations completed successfully'
      if (logger?.info) {
        logger.info(successMessage)
      } else {
        console.log(successMessage)
      }
    } finally {
      await db.execute(sql.raw(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`))
      const releasedMessage = 'Released migration lock'
      if (logger?.info) {
        logger.info(releasedMessage)
      } else {
        console.log(releasedMessage)
      }
    }
  } catch (error) {
    const errorMsg = 'Error during migration lock process:'
    if (logger?.error) {
      logger.error(errorMsg, error)
    } else {
      console.error(errorMsg, error)
    }
    throw error
  }
}

/**
 * Drop all schemas and recreate public schema
 */
export async function dropAll(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS public CASCADE`))
    await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS drizzle CASCADE`))
    await tx.execute(sql.raw(`CREATE SCHEMA public`))
  })
}

/**
 * Reset database by clearing all data using drizzle-seed
 */
export async function resetDb(
  db: NodePgDatabase<typeof schema>,
  logger?: {
    info?: (message: string) => void
    warn?: (message: string) => void
    error?: (message: string, error?: unknown) => void
  }
): Promise<void> {
  const maxRetries = 3
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      if (retryCount > 0) {
        const delay = Math.pow(2, retryCount) * 100
        const message = `Retrying database reset (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms delay...`
        if (logger?.info) {
          logger.info(message)
        } else {
          console.log(message)
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      await reset(db, schema)
      return
    } catch (error: unknown) {
      retryCount++

      const errorMessage = error instanceof Error ? error.message : ''
      const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : ''
      const isDeadlock =
        errorMessage.includes('deadlock') || errorCode === '40P01' || errorCode === '40001'

      if (isDeadlock && retryCount < maxRetries) {
        const message = `Database deadlock detected on attempt ${retryCount}/${maxRetries}, retrying...`
        if (logger?.warn) {
          logger.warn(message)
        } else {
          console.warn(message)
        }
        continue
      }

      const errorMsg = `Database reset failed after ${retryCount} attempts:`
      if (logger?.error) {
        logger.error(errorMsg, error)
      } else {
        console.error(errorMsg, error)
      }
      throw error
    }
  }
}

/**
 * Close database connection pool
 */
export async function closeDb(pool: Pool): Promise<void> {
  if (pool) {
    await pool.end()
    console.log('Database connection pool closed')
  }
}
