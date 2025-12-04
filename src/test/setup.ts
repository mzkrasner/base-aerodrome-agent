/**
 * @file Test Setup
 * @description Global test configuration (runs before each test file)
 */
import { config } from 'dotenv'
import path from 'path'
import { afterAll, afterEach, beforeEach } from 'vitest'

import { testDbManager } from './test-db-manager'

// Load test environment variables
const envTestPath = path.resolve(__dirname, '../../.env.test')
config({ path: envTestPath, override: true })

// Ensure TEST_MODE is set
process.env.TEST_MODE = 'true'

// Before each test
beforeEach(async () => {
  // Ensure database is initialized (has guard, only runs once)
  await testDbManager.initialize()
})

// After each test
afterEach(async () => {
  // Clean up database state
  await testDbManager.resetDatabase()
})

// After all tests in this file
afterAll(async () => {
  // Note: We don't close connections here because other test files might still be running
  // The connection will be closed when the process exits
})
