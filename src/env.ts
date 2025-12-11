/**
 * Environment loader - MUST be imported first in any entry point
 *
 * This file loads environment variables synchronously before any other code runs.
 */
import dotenv from 'dotenv'

// Load .env file synchronously
dotenv.config()

// Re-export for explicit usage
export { dotenv }
