/**
 * All tools for the Aerodrome Trading Agent
 *
 * These tools gather raw data - the agent interprets what it means.
 * No hardcoded decision logic, scoring, or recommendations in tools.
 */

// Aerodrome DEX tools
export { getQuoteTool, getPoolMetricsTool, executeSwapTool } from './aerodrome/index.js'

// Market data tools
export { getTokenPriceTool, getWalletBalanceTool, getIndicatorsTool } from './market/index.js'

// Sentiment tools
export { getTwitterSentimentTool } from './sentiment/index.js'
