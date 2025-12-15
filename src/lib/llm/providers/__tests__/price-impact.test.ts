/**
 * Price Impact Protection Tests
 *
 * Tests the price impact validation logic that prevents trades with excessive slippage.
 * This protects against scenarios where the quote itself is terrible (e.g., 50% loss)
 * even though the execution would be within the 1% slippage tolerance.
 *
 * Example of what this prevents:
 * - Input: 50 USDC
 * - Quote: 1,600 BRETT (but worth only $24!)
 * - Without protection: Trade executes, loses 52%
 * - With protection: Trade rejected because $24/$50 = 52% price impact > 5% max
 */
import { describe, expect, it } from 'vitest'

// =============================================================================
// Price Impact Calculation Logic (extracted for testing)
// =============================================================================

/**
 * Calculate price impact percentage
 * @param inputValueUsd - USD value being swapped in (e.g., 50)
 * @param outputValueUsd - USD value expected out (e.g., 24)
 * @returns Price impact as a percentage (e.g., 52.0)
 */
function calculatePriceImpact(inputValueUsd: number, outputValueUsd: number): number {
  if (inputValueUsd <= 0) return 0
  return ((inputValueUsd - outputValueUsd) / inputValueUsd) * 100
}

/**
 * Check if a trade should be rejected based on price impact
 * @param inputValueUsd - USD value being swapped in
 * @param outputValueUsd - USD value expected out
 * @param maxImpactPercent - Maximum allowed price impact (default 5%)
 * @returns Object with rejection status and details
 */
function checkPriceImpact(
  inputValueUsd: number,
  outputValueUsd: number,
  maxImpactPercent: number = 5.0
): { shouldReject: boolean; impactPercent: number; reason?: string } {
  const impactPercent = calculatePriceImpact(inputValueUsd, outputValueUsd)

  if (impactPercent > maxImpactPercent) {
    return {
      shouldReject: true,
      impactPercent,
      reason: `${impactPercent.toFixed(1)}% price impact exceeds ${maxImpactPercent}% max`,
    }
  }

  return {
    shouldReject: false,
    impactPercent,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Price Impact Protection', () => {
  describe('calculatePriceImpact', () => {
    it('calculates 0% impact for equal values', () => {
      expect(calculatePriceImpact(100, 100)).toBe(0)
    })

    it('calculates positive impact when output < input (loss)', () => {
      // $100 in, $95 out = 5% loss
      expect(calculatePriceImpact(100, 95)).toBe(5)
    })

    it('calculates large impact for terrible trades', () => {
      // $50 in, $24 out = 52% loss (the BRETT trade scenario)
      expect(calculatePriceImpact(50, 24)).toBe(52)
    })

    it('calculates negative impact when output > input (gain)', () => {
      // $100 in, $105 out = -5% (actually a gain, negative impact)
      expect(calculatePriceImpact(100, 105)).toBe(-5)
    })

    it('handles zero input gracefully', () => {
      expect(calculatePriceImpact(0, 100)).toBe(0)
    })

    it('handles small amounts correctly', () => {
      // $10 in, $9.50 out = 5% loss
      expect(calculatePriceImpact(10, 9.5)).toBe(5)
    })
  })

  describe('checkPriceImpact', () => {
    it('accepts trades with 0% impact', () => {
      const result = checkPriceImpact(100, 100)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(0)
    })

    it('accepts trades with small impact (< 5%)', () => {
      // 2% impact - acceptable
      const result = checkPriceImpact(100, 98)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(2)
    })

    it('accepts trades at exactly the threshold', () => {
      // Exactly 5% impact - acceptable (not greater than)
      const result = checkPriceImpact(100, 95)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(5)
    })

    it('REJECTS trades with impact > 5%', () => {
      // 5.1% impact - rejected
      const result = checkPriceImpact(100, 94.9)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBeCloseTo(5.1, 1)
      expect(result.reason).toContain('5.1%')
      expect(result.reason).toContain('exceeds')
    })

    it('REJECTS the BRETT trade scenario (52% impact)', () => {
      // $50 USDC → $24 worth of BRETT = 52% loss
      const result = checkPriceImpact(50, 24)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(52)
      expect(result.reason).toContain('52.0%')
    })

    it('REJECTS extreme slippage (90% loss)', () => {
      // $100 in, $10 out = 90% loss
      const result = checkPriceImpact(100, 10)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(90)
    })

    it('allows custom max impact threshold', () => {
      // 10% impact with 15% max threshold - acceptable
      const result = checkPriceImpact(100, 90, 15)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(10)
    })

    it('uses stricter threshold when specified', () => {
      // 3% impact with 2% max threshold - rejected
      const result = checkPriceImpact(100, 97, 2)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(3)
    })

    it('accepts trades with negative impact (gains)', () => {
      // Getting more out than in is always acceptable
      const result = checkPriceImpact(100, 110)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(-10) // -10% = 10% gain
    })
  })

  describe('Real-world scenarios', () => {
    it('accepts normal USDC → WETH trade with 0.5% DEX fee', () => {
      // $100 USDC → $99.50 worth of WETH (0.5% fee is normal)
      const result = checkPriceImpact(100, 99.5)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(0.5)
    })

    it('accepts low liquidity token trade with 3% impact', () => {
      // $50 USDC → $48.50 worth of meme token (3% is acceptable)
      const result = checkPriceImpact(50, 48.5)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBe(3)
    })

    it('REJECTS low liquidity trade with 20% impact', () => {
      // $100 USDC → $80 worth of illiquid token
      const result = checkPriceImpact(100, 80)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(20)
    })

    it('REJECTS sandwich attack scenario', () => {
      // Attacker front-runs, quote shows terrible rate
      // $500 USDC → $350 worth of tokens (30% loss)
      const result = checkPriceImpact(500, 350)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(30)
    })

    it('handles small trades correctly', () => {
      // $5 USDC → $4.90 worth of token (2% impact - acceptable)
      const result = checkPriceImpact(5, 4.9)
      expect(result.shouldReject).toBe(false)
      expect(result.impactPercent).toBeCloseTo(2, 5) // Use toBeCloseTo for floating point
    })

    it('handles large trades correctly', () => {
      // $10,000 USDC → $9,400 worth of token (6% impact - rejected)
      const result = checkPriceImpact(10000, 9400)
      expect(result.shouldReject).toBe(true)
      expect(result.impactPercent).toBe(6)
    })
  })
})
