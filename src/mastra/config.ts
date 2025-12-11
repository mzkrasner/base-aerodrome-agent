// Load environment variables FIRST - this import MUST come before anything else
import '../env.js'

import { ConsoleLogger } from '@mastra/core/logger'
import { Mastra } from '@mastra/core/mastra'

import { aerodromeAgent } from '../agents/trading.agent.js'
import { eigenaiGateway } from '../lib/llm/index.js'

/**
 * Mastra Configuration
 *
 * This wires up the trading agent for:
 * - Studio UI (interactive chat, tool testing)
 * - REST API endpoints (programmatic access)
 * - Custom gateways for LLM providers (EigenAI)
 *
 * Run with: pnpm mastra:dev
 * Studio available at: http://localhost:4111
 *
 * LLM Provider Configuration:
 * - Set LLM_PROVIDER env var to switch providers ('anthropic' | 'openai' | 'eigenai')
 * - Anthropic: Set ANTHROPIC_API_KEY
 * - OpenAI: Set OPENAI_API_KEY
 * - EigenAI: Set EIGENAI_PRIVATE_KEY (wallet key for request signing)
 */
export const mastra = new Mastra({
  agents: {
    aerodromeTrader: aerodromeAgent,
  },
  gateways: {
    eigenai: eigenaiGateway,
  },
  logger: new ConsoleLogger({ name: 'AerodromeAgent', level: 'info' }),
})
