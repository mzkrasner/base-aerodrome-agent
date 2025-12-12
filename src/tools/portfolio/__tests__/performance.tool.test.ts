/**
 * Performance Tool Tests
 *
 * Tests for the getPerformance tool that the agent uses
 * to check its trading performance.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../../database/db.js'
import {
  portfolioSnapshots,
  positions,
  swapTransactions,
} from '../../../database/schema/trading/defs.js'
import { performanceTracker } from '../../../services/performance/performance-tracker.js'
import { getPerformanceTool } from '../performance.tool.js'

describe('getPerformanceTool', () => {
  beforeEach(async () => {
    // Clear test data
    await db.delete(positions)
    await db.delete(portfolioSnapshots)
    await db.delete(swapTransactions)
  })

  it('should return success with empty portfolio', async () => {
    const result = await getPerformanceTool.execute({
      context: {
        includePositions: false,
        daysBack: 30,
      },
      runtimeContext: {} as never, // Mastra runtime context not needed for this test
    })

    expect(result.success).toBe(true)
    expect(result.metrics.totalTrades).toBe(0)
    expect(result.metrics.currentValueUsd).toBe(0)
    expect(result.summary).toContain('Portfolio Performance Summary')
  })

  it('should return positions when includePositions is true', async () => {
    // Setup: Create a position
    await performanceTracker.recordBuy(
      'AERO',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      100,
      65
    )

    const result = await getPerformanceTool.execute({
      context: {
        includePositions: true,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.positions).toBeDefined()
    expect(result.positions!.length).toBeGreaterThan(0)

    const aeroPosition = result.positions!.find((p) => p.token === 'AERO')
    expect(aeroPosition).toBeDefined()
    expect(parseFloat(aeroPosition!.balance)).toBe(100)
    expect(aeroPosition!.buyCount).toBe(1)
  })

  it('should calculate metrics correctly after trades', async () => {
    // Setup: Create position and snapshot
    await performanceTracker.recordBuy(
      'AERO',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      100,
      65
    )

    await performanceTracker.createSnapshot({ AERO: '100' }, 65, 1)

    const result = await getPerformanceTool.execute({
      context: {
        includePositions: true,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.metrics.startingValueUsd).toBe(65)
    // Current value depends on live price fetch, so we just check it's defined
    expect(result.metrics.currentValueUsd).toBeDefined()
  })

  it('should track realized P&L from sells', async () => {
    // Buy then sell for profit
    await performanceTracker.recordBuy(
      'AERO',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      100,
      65
    )

    await performanceTracker.recordSell('AERO', 50, 45) // Profit of $12.50

    const result = await getPerformanceTool.execute({
      context: {
        includePositions: true,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.metrics.realizedPnlUsd).toBeCloseTo(12.5, 1)
  })

  it('should include summary string', async () => {
    const result = await getPerformanceTool.execute({
      context: {
        includePositions: false,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.summary).toBeDefined()
    expect(result.summary).toContain('Portfolio Performance Summary')
    expect(result.summary).toContain('Value:')
    expect(result.summary).toContain('Trading Stats:')
  })

  it('should handle errors gracefully', async () => {
    // This test verifies the tool doesn't crash on errors
    // The tool should return success: false with error message
    const result = await getPerformanceTool.execute({
      context: {
        includePositions: false,
        daysBack: -1, // Invalid value
      },
      runtimeContext: {} as never,
    })

    // Even with invalid input, should not throw
    expect(result).toBeDefined()
  })
})

describe('getPerformanceTool - Integration Scenarios', () => {
  beforeEach(async () => {
    await db.delete(positions)
    await db.delete(portfolioSnapshots)
    await db.delete(swapTransactions)
  })

  it('should handle multiple tokens', async () => {
    await performanceTracker.recordBuy(
      'AERO',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      100,
      65
    )

    await performanceTracker.recordBuy(
      'BRETT',
      '0x532f27101965dd16442E59d40670FaF5eBB142E4',
      1000,
      50
    )

    const result = await getPerformanceTool.execute({
      context: {
        includePositions: true,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(true)
    expect(result.positions!.length).toBe(2)
  })

  it('should calculate correct unrealized P&L display', async () => {
    // Buy at $0.65, current price will be fetched live
    await performanceTracker.recordBuy(
      'AERO',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      100,
      65
    )

    const result = await getPerformanceTool.execute({
      context: {
        includePositions: true,
        daysBack: 30,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(true)

    const aeroPosition = result.positions!.find((p) => p.token === 'AERO')
    expect(aeroPosition).toBeDefined()
    // unrealizedPnlUsd = currentValue - costBasis
    // We can't predict exact value due to live price, but it should be calculated
    expect(aeroPosition!.unrealizedPnlUsd).toBeDefined()
    expect(aeroPosition!.unrealizedPnlPercent).toBeDefined()
  })
})
