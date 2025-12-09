/**
 * Portfolio Performance Tool
 *
 * Allows the agent to check its own trading performance:
 * - Current portfolio value and P&L
 * - Win rate and trade statistics
 * - Position-level details with cost basis
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

import { resolveToken } from '../../config/tokens.js'
import { performanceTracker } from '../../services/performance-tracker.js'

/**
 * Helper to get current price for a token
 */
async function fetchCurrentPrice(token: string): Promise<number> {
  const tokenMeta = resolveToken(token)
  if (!tokenMeta) return 0

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenMeta.address}`
    )
    if (!response.ok) return 0

    const data = (await response.json()) as {
      pairs?: Array<{
        chainId: string
        priceUsd?: string
        liquidity?: { usd?: number }
      }>
    }

    if (data.pairs && data.pairs.length > 0) {
      // Find the Base chain pair with highest liquidity
      const basePairs = data.pairs.filter((p) => p.chainId === 'base')
      if (basePairs.length === 0) return 0

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]

      return parseFloat(bestPair.priceUsd || '0')
    }
    return 0
  } catch {
    return 0
  }
}

export const getPerformanceTool = createTool({
  id: 'get-performance',
  description: `Get your trading performance metrics and P&L.
Returns portfolio value, realized/unrealized P&L, win rate, and trade statistics.
Use this to assess how well your trading strategy is working.`,

  inputSchema: z.object({
    includePositions: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include detailed position breakdown with cost basis'),
    daysBack: z.number().optional().default(30).describe('Number of days of history to analyze'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    metrics: z.object({
      currentValueUsd: z.number(),
      startingValueUsd: z.number(),
      totalPnlUsd: z.number(),
      totalPnlPercent: z.number(),
      realizedPnlUsd: z.number(),
      unrealizedPnlUsd: z.number(),
      winningTrades: z.number(),
      losingTrades: z.number(),
      winRate: z.number(),
      totalTrades: z.number(),
      avgTradeSizeUsd: z.number(),
      bestTradeUsd: z.number(),
      worstTradeUsd: z.number(),
      totalGasSpentUsd: z.number(),
      timeframe: z.object({
        start: z.string(),
        end: z.string(),
        daysActive: z.number(),
      }),
    }),
    positions: z
      .array(
        z.object({
          token: z.string(),
          balance: z.string(),
          currentPriceUsd: z.number(),
          currentValueUsd: z.number(),
          averageCostPerToken: z.string().nullable(),
          totalCostUsd: z.string(),
          unrealizedPnlUsd: z.number(),
          unrealizedPnlPercent: z.number(),
          realizedPnlUsd: z.string(),
          buyCount: z.number(),
          sellCount: z.number(),
        })
      )
      .optional(),
    summary: z.string(),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { includePositions, daysBack } = context

    try {
      const hoursBack = daysBack * 24
      const metrics = await performanceTracker.getPerformanceMetrics(fetchCurrentPrice, hoursBack)

      const summary = await performanceTracker.getPerformanceSummary(fetchCurrentPrice)

      let positionsData: Array<{
        token: string
        balance: string
        currentPriceUsd: number
        currentValueUsd: number
        averageCostPerToken: string | null
        totalCostUsd: string
        unrealizedPnlUsd: number
        unrealizedPnlPercent: number
        realizedPnlUsd: string
        buyCount: number
        sellCount: number
      }> = []

      if (includePositions) {
        const positionsWithValues =
          await performanceTracker.getPositionsWithValues(fetchCurrentPrice)
        positionsData = positionsWithValues.map((pos) => ({
          token: pos.token,
          balance: pos.balance,
          currentPriceUsd: pos.currentPriceUsd,
          currentValueUsd: pos.currentValueUsd,
          averageCostPerToken: pos.averageCostPerToken,
          totalCostUsd: pos.totalCostUsd,
          unrealizedPnlUsd: pos.unrealizedPnlUsd,
          unrealizedPnlPercent: pos.unrealizedPnlPercent,
          realizedPnlUsd: pos.realizedPnlUsd,
          buyCount: pos.buyCount,
          sellCount: pos.sellCount,
        }))
      }

      return {
        success: true,
        metrics,
        positions: includePositions ? positionsData : undefined,
        summary,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        metrics: {
          currentValueUsd: 0,
          startingValueUsd: 0,
          totalPnlUsd: 0,
          totalPnlPercent: 0,
          realizedPnlUsd: 0,
          unrealizedPnlUsd: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalTrades: 0,
          avgTradeSizeUsd: 0,
          bestTradeUsd: 0,
          worstTradeUsd: 0,
          totalGasSpentUsd: 0,
          timeframe: {
            start: new Date().toISOString(),
            end: new Date().toISOString(),
            daysActive: 0,
          },
        },
        summary: 'Failed to retrieve performance metrics',
        error: errorMessage,
      }
    }
  },
})
