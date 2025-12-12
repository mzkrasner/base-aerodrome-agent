import 'dotenv/config'

import { closeConnection, healthCheck } from './database/db.js'
import { startTradingLoop } from './loop/index.js'
import { initializeEigenAIInferenceTracking } from './services/eigen/eigenai-inference.service.js'
import { initializeRecallSubmission, recallSubmissionService } from './services/recall/index.js'

/**
 * Aerodrome Trading Agent
 * Autonomous spot trading on Aerodrome DEX (Base chain) using Mastra
 */

async function initializeDatabase(): Promise<void> {
  console.log('🗄️  Initializing database connection...')

  try {
    const isHealthy = await healthCheck()
    if (!isHealthy) {
      throw new Error('Database health check failed')
    }
    console.log('✅ Database connection established')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

async function validateEnvironment(): Promise<void> {
  console.log('🔍 Validating environment configuration...')

  // Base required vars
  const requiredEnvVars = ['DATABASE_URL']

  // LLM provider validation
  const llmProvider = process.env.LLM_PROVIDER || 'anthropic'
  console.log(`🤖 LLM Provider: ${llmProvider}`)

  switch (llmProvider) {
    case 'anthropic':
      requiredEnvVars.push('ANTHROPIC_API_KEY')
      break
    case 'openai':
      requiredEnvVars.push('OPENAI_API_KEY')
      break
    case 'eigenai':
      // EigenAI requires either API key or private key
      if (!process.env.EIGENAI_API_KEY && !process.env.EIGENAI_PRIVATE_KEY) {
        throw new Error('EigenAI requires either EIGENAI_API_KEY or EIGENAI_PRIVATE_KEY')
      }
      break
  }

  const optionalEnvVars = ['AGENT_PRIVATE_KEY', 'BASE_RPC_URL', 'GROK_API_KEY']

  // Check required variables
  const missingRequired = requiredEnvVars.filter((envVar) => !process.env[envVar])
  if (missingRequired.length > 0) {
    throw new Error(`Missing required environment variables: ${missingRequired.join(', ')}`)
  }

  // Check optional variables
  const missingOptional = optionalEnvVars.filter((envVar) => !process.env[envVar])
  if (missingOptional.length > 0) {
    console.warn(`⚠️  Missing optional environment variables: ${missingOptional.join(', ')}`)
    if (missingOptional.includes('AGENT_PRIVATE_KEY')) {
      console.warn('   Trading execution disabled (no wallet)')
    }
    if (missingOptional.includes('GROK_API_KEY')) {
      console.warn('   Sentiment analysis disabled')
    }
  }

  console.log('✅ Environment validation complete')
}

async function gracefulShutdown(): Promise<void> {
  console.log('🛑 Initiating graceful shutdown...')

  try {
    // Stop Recall submission service
    recallSubmissionService.stop()

    await closeConnection()
    console.log('✅ Database connections closed')
    console.log('✅ Graceful shutdown complete')
    process.exit(0)
  } catch (error) {
    console.error('❌ Error during shutdown:', error)
    process.exit(1)
  }
}

async function startApplication(): Promise<void> {
  console.log('🚀 Starting Aerodrome Trading Agent...')
  console.log(`📅 Timestamp: ${new Date().toISOString()}`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)

  try {
    // Step 1: Validate environment
    await validateEnvironment()

    // Step 2: Initialize database
    await initializeDatabase()

    // Step 3: Initialize EigenAI inference tracking and Recall submission (if using EigenAI)
    if (process.env.LLM_PROVIDER === 'eigenai') {
      initializeEigenAIInferenceTracking()
      initializeRecallSubmission()
    }

    // Step 4: Set up signal handlers
    process.on('SIGINT', gracefulShutdown)
    process.on('SIGTERM', gracefulShutdown)
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error)
      void gracefulShutdown()
    })
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason)
      void gracefulShutdown()
    })

    console.log('🎉 Aerodrome Trading Agent initialized!')

    // Step 5: Start the autonomous trading loop
    await startTradingLoop()

    // Keep the process running with periodic health checks
    setInterval(() => {
      healthCheck()
        .then((isHealthy) => {
          if (!isHealthy) {
            console.error('❌ Database health check failed during runtime')
          }
        })
        .catch((error) => {
          console.error('❌ Health check error:', error)
        })
    }, 300000) // Every 5 minutes
  } catch (error) {
    console.error('❌ Application startup failed:', error)
    await gracefulShutdown()
  }
}

// Start the application if this file is run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  startApplication().catch((error) => {
    console.error('❌ Fatal startup error:', error)
    process.exit(1)
  })
}

export default startApplication
