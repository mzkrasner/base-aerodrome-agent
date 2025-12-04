/**
 * @file Test Database Manager
 * @description Manages test database lifecycle
 */
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import path from 'path'
import { Client } from 'pg'

import { closeDb, db, dropAll, migrateDb, resetDb } from './database'

export class TestDbManager {
  private static instance: TestDbManager
  private initialized = false

  private constructor() {
    config({ path: path.resolve(__dirname, '../../.env.test') })
  }

  public static getInstance(): TestDbManager {
    if (!TestDbManager.instance) {
      TestDbManager.instance = new TestDbManager()
    }
    return TestDbManager.instance
  }

  private async ensureTestDatabaseExists(): Promise<void> {
    const url = new URL(
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/aerodrome_test'
    )

    const dbName = url.pathname.slice(1)

    const client = new Client({
      host: url.hostname || 'localhost',
      port: parseInt(url.port || '5432'),
      user: url.username || 'postgres',
      password: url.password || 'postgres',
      database: 'postgres',
    })

    try {
      await client.connect()
      console.log(`Connected to postgres to check if database ${dbName} exists`)

      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT FROM pg_database WHERE datname = $1);`,
        [dbName]
      )

      if (!result.rows[0]?.exists) {
        console.log(`Test database "${dbName}" does not exist, creating it...`)
        await client.query(`CREATE DATABASE "${dbName}";`)
        console.log(`Test database "${dbName}" created successfully`)
      } else {
        console.log(`Test database "${dbName}" already exists`)
      }
    } catch (error) {
      console.error('Error ensuring test database exists:', error)
      throw error
    } finally {
      await client.end()
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('Database already initialized')
      return
    }

    console.log('Starting database initialization...')

    try {
      await this.ensureTestDatabaseExists()

      try {
        await db.execute(sql.raw('SELECT 1'))
        console.log(`Connected to database successfully`)
      } catch (error) {
        console.error('Error connecting to database:', error)
        throw error
      }

      console.log('Dropping all existing tables to ensure a clean schema...')
      try {
        await dropAll()
        console.log('All existing tables have been dropped successfully')
      } catch (error) {
        console.warn('Error dropping tables:', error)
        console.log('Continuing with initialization...')
      }

      console.log('[Database] Migrating database schema...')
      await migrateDb()

      console.log('Database schema initialized successfully')
      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize database:', error)
      throw error
    }
  }

  public async resetDatabase(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
    await resetDb()
  }

  public async connect() {
    return db
  }

  public async close(): Promise<void> {
    try {
      console.log('Closing database connections...')
      await closeDb()
      this.initialized = false
      console.log('Database connections closed successfully')
    } catch (error) {
      console.error('Error closing database connections:', error)
      this.initialized = false
    }
  }
}

export const testDbManager = TestDbManager.getInstance()
