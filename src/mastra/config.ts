import { ConsoleLogger } from '@mastra/core/logger'
import { Mastra } from '@mastra/core/mastra'
import { LangfuseExporter } from '@mastra/langfuse'

import { aerodromeAgent } from '../agents/trading.agent.js'

/**
 * Configure Langfuse observability exporter
 * Realtime mode in development for immediate trace visibility
 * Batch mode in production for better performance
 */
const langfuseExporter =
  process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY
    ? new LangfuseExporter({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        realtime: process.env.NODE_ENV === 'development',
        options: {
          environment: process.env.NODE_ENV || 'development',
        },
      })
    : undefined

/**
 * Mastra Configuration with Langfuse observability
 *
 * This wires up the trading agent for:
 * - Studio UI (interactive chat, tool testing)
 * - REST API endpoints (programmatic access)
 * - Langfuse tracing (when credentials are provided)
 *
 * Run with: pnpm mastra:dev
 * Studio available at: http://localhost:4111
 */
export const mastra = new Mastra({
  agents: {
    aerodromeTrader: aerodromeAgent,
  },
  logger: new ConsoleLogger({ name: 'AerodromeAgent', level: 'info' }),
  server: {
    // Higher maxSteps for Studio UI (default is 5, which cuts off swap executions)
    defaultGenerateOptions: {
      maxSteps: 20,
    },
  },
  observability: langfuseExporter
    ? {
        configs: {
          langfuse: {
            serviceName: 'aerodrome-trading-agent',
            exporters: [langfuseExporter],
          },
        },
      }
    : undefined,
})
