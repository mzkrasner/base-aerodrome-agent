import { createLogger } from '@mastra/core/logger'
import { Mastra } from '@mastra/core/mastra'

// Simple configuration matching the working pattern
export const mastra = new Mastra({
  workflows: {}, // Will be populated when we add workflows
  logger: createLogger({ name: 'PolymarketAgent', level: 'info' }),
})
