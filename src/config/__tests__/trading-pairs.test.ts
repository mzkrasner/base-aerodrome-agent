/**
 * Trading Pairs Configuration Tests
 *
 * Tests the configurable TRADING_PAIRS environment variable functionality.
 * Verifies parsing, validation, and fallback behavior.
 *
 * Run with: pnpm test src/config/__tests__/trading-pairs.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type TradingPair, getTradingPairs } from '../index'
import { DEFAULT_TRADING_PAIRS, resolveToken } from '../tokens'

describe('Trading Pairs Configuration', () => {
  // Store original env
  const originalEnv = process.env.TRADING_PAIRS

  beforeEach(() => {
    // Clear env before each test
    delete process.env.TRADING_PAIRS
    // Suppress console.warn/log for cleaner test output
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.TRADING_PAIRS = originalEnv
    } else {
      delete process.env.TRADING_PAIRS
    }
    vi.restoreAllMocks()
  })

  describe('Default behavior', () => {
    it('returns DEFAULT_TRADING_PAIRS when TRADING_PAIRS is not set', () => {
      const pairs = getTradingPairs()

      expect(pairs).toEqual(DEFAULT_TRADING_PAIRS)
      expect(pairs.length).toBeGreaterThan(0)
    })

    it('returns DEFAULT_TRADING_PAIRS when TRADING_PAIRS is empty string', () => {
      process.env.TRADING_PAIRS = ''
      const pairs = getTradingPairs()

      expect(pairs).toEqual(DEFAULT_TRADING_PAIRS)
    })

    it('returns DEFAULT_TRADING_PAIRS when TRADING_PAIRS is whitespace only', () => {
      process.env.TRADING_PAIRS = '   '
      const pairs = getTradingPairs()

      expect(pairs).toEqual(DEFAULT_TRADING_PAIRS)
    })
  })

  describe('Comma-separated pairs', () => {
    it('parses single pair correctly', () => {
      process.env.TRADING_PAIRS = 'WETH/USDC'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([{ quote: 'WETH', base: 'USDC' }])
    })

    it('parses multiple comma-separated pairs', () => {
      process.env.TRADING_PAIRS = 'WETH/USDC,AERO/USDC,BRETT/WETH'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([
        { quote: 'WETH', base: 'USDC' },
        { quote: 'AERO', base: 'USDC' },
        { quote: 'BRETT', base: 'WETH' },
      ])
    })

    it('handles extra whitespace around pairs', () => {
      process.env.TRADING_PAIRS = '  WETH/USDC  ,  AERO/USDC  '
      const pairs = getTradingPairs()

      expect(pairs).toEqual([
        { quote: 'WETH', base: 'USDC' },
        { quote: 'AERO', base: 'USDC' },
      ])
    })
  })

  describe('Space-separated pairs', () => {
    it('parses space-separated pairs when no commas present', () => {
      process.env.TRADING_PAIRS = 'WETH/USDC AERO/USDC BRETT/WETH'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([
        { quote: 'WETH', base: 'USDC' },
        { quote: 'AERO', base: 'USDC' },
        { quote: 'BRETT', base: 'WETH' },
      ])
    })
  })

  describe('Case normalization', () => {
    it('normalizes lowercase symbols to uppercase', () => {
      process.env.TRADING_PAIRS = 'weth/usdc,aero/usdc'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([
        { quote: 'WETH', base: 'USDC' },
        { quote: 'AERO', base: 'USDC' },
      ])
    })

    it('handles mixed case correctly', () => {
      process.env.TRADING_PAIRS = 'Weth/Usdc,AeRo/UsDc'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([
        { quote: 'WETH', base: 'USDC' },
        { quote: 'AERO', base: 'USDC' },
      ])
    })
  })

  describe('Invalid format handling', () => {
    it('skips pairs without slash separator', () => {
      process.env.TRADING_PAIRS = 'WETH-USDC,AERO/USDC'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([{ quote: 'AERO', base: 'USDC' }])
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid pair format "WETH-USDC"')
      )
    })

    it('skips pairs with missing base', () => {
      process.env.TRADING_PAIRS = 'WETH/,AERO/USDC'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([{ quote: 'AERO', base: 'USDC' }])
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('both quote and base required')
      )
    })

    it('skips pairs with missing quote', () => {
      process.env.TRADING_PAIRS = '/USDC,AERO/USDC'
      const pairs = getTradingPairs()

      expect(pairs).toEqual([{ quote: 'AERO', base: 'USDC' }])
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('both quote and base required')
      )
    })

    it('returns defaults when all pairs are invalid', () => {
      process.env.TRADING_PAIRS = 'INVALID,ALSO-INVALID'
      const pairs = getTradingPairs()

      expect(pairs).toEqual(DEFAULT_TRADING_PAIRS)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No valid pairs parsed from TRADING_PAIRS')
      )
    })
  })

  describe('Token validation integration', () => {
    it('parsed pairs contain tokens that can be resolved', () => {
      // Use tokens we know exist
      process.env.TRADING_PAIRS = 'WETH/USDC,AERO/USDC,BRETT/WETH'
      const pairs = getTradingPairs()

      for (const pair of pairs) {
        const quoteToken = resolveToken(pair.quote)
        const baseToken = resolveToken(pair.base)

        expect(quoteToken).toBeDefined()
        expect(quoteToken?.symbol).toBe(pair.quote)
        expect(baseToken).toBeDefined()
        expect(baseToken?.symbol).toBe(pair.base)
      }
    })

    it('allows unknown tokens (validation happens elsewhere)', () => {
      // The parser doesn't validate token existence - that happens at runtime
      process.env.TRADING_PAIRS = 'UNKNOWN/USDC,WETH/USDC'
      const pairs = getTradingPairs()

      // Should still parse successfully
      expect(pairs).toHaveLength(2)
      expect(pairs[0]).toEqual({ quote: 'UNKNOWN', base: 'USDC' })

      // But the token won't resolve
      expect(resolveToken('UNKNOWN')).toBeUndefined()
    })
  })

  describe('Real-world scenarios', () => {
    it('handles EigenAI competition tokens', () => {
      process.env.TRADING_PAIRS =
        'WBTC/USDC,WETH/USDC,AERO/WETH,EIGEN/WETH,BRETT/WETH,MIGGLES/WETH,PONKE/WETH'
      const pairs = getTradingPairs()

      expect(pairs).toHaveLength(7)
      expect(pairs.map((p) => p.quote)).toEqual([
        'WBTC',
        'WETH',
        'AERO',
        'EIGEN',
        'BRETT',
        'MIGGLES',
        'PONKE',
      ])
    })

    it('handles minimal config with just one pair', () => {
      process.env.TRADING_PAIRS = 'WETH/USDC'
      const pairs = getTradingPairs()

      expect(pairs).toHaveLength(1)
      expect(pairs[0]).toEqual({ quote: 'WETH', base: 'USDC' })
    })

    it('handles config with duplicates (does not dedupe)', () => {
      process.env.TRADING_PAIRS = 'WETH/USDC,WETH/USDC,WETH/USDC'
      const pairs = getTradingPairs()

      // Parser doesn't dedupe - that's a user configuration issue
      expect(pairs).toHaveLength(3)
    })
  })

  describe('Return type immutability', () => {
    it('returns a new array for defaults (not the original reference)', () => {
      const pairs1 = getTradingPairs()
      const pairs2 = getTradingPairs()

      // Should be equal in content
      expect(pairs1).toEqual(pairs2)
      // But not the same reference
      expect(pairs1).not.toBe(pairs2)
    })
  })
})

/**
 * Helper to generate a TRADING_PAIRS string from pairs
 */
export function formatTradingPairs(pairs: TradingPair[]): string {
  return pairs.map((p) => `${p.quote}/${p.base}`).join(',')
}
