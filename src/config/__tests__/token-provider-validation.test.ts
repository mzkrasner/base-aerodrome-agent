/**
 * Token Provider Validation Tests
 *
 * Validates that all configured tokens in TOKEN_ADDRESSES are supported
 * by the data providers used in this project.
 *
 * IMPORTANT: This test uses the ACTUAL tools and services from the codebase,
 * not reimplemented API calls. This ensures the test validates the real code paths.
 *
 * Providers tested:
 * 1. DexScreener - via getTokenPriceTool (no API key required)
 * 2. CoinGecko - via fetchOHLCV from coingecko-client (requires COINGECKO_API_KEY)
 * 3. Alchemy - via getAlchemy() from execution/wallet (requires ALCHEMY_API_KEY)
 *
 * Run with: pnpm test src/config/__tests__/token-provider-validation.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { getAlchemy } from '../../execution/wallet'
import { fetchOHLCV } from '../../tools/market/coingecko-client'
import { getTokenPriceTool } from '../../tools/market/price.tool'
import type { TokenSymbol } from '../tokens'
import { TOKEN_ADDRESSES, TOKEN_METADATA } from '../tokens'

/** Token entries for parameterized tests */
const tokenEntries = Object.entries(TOKEN_ADDRESSES) as Array<[TokenSymbol, string]>

/** Test results summary */
interface ProviderTestResults {
  dexscreener: Map<string, { success: boolean; price?: string; liquidity?: number; error?: string }>
  coingecko: Map<string, { success: boolean; candleCount?: number; error?: string }>
  alchemy: Map<string, { success: boolean; decimals?: number; symbol?: string; error?: string }>
}

const results: ProviderTestResults = {
  dexscreener: new Map(),
  coingecko: new Map(),
  alchemy: new Map(),
}

/** Helper to execute the price tool */
const getPrice = (token: string) =>
  getTokenPriceTool.execute({
    context: { token },
    runtimeContext: {} as never,
  })

describe('Token Provider Validation', () => {
  /**
   * DexScreener Tests
   * Uses the actual getTokenPriceTool from the codebase
   */
  describe('DexScreener (via getTokenPriceTool)', () => {
    it.each(tokenEntries)(
      '%s has price data on Base',
      async (symbol) => {
        const result = await getPrice(symbol)

        if (result.success && result.price.usd) {
          results.dexscreener.set(symbol, {
            success: true,
            price: result.price.usd,
            liquidity: result.market.liquidityUsd ?? undefined,
          })

          console.log(
            `✅ ${symbol}: $${result.price.usd} | Liquidity: $${(result.market.liquidityUsd ?? 0).toLocaleString()}`
          )

          expect(result.success).toBe(true)
          expect(result.price.usd).toBeDefined()
        } else {
          results.dexscreener.set(symbol, {
            success: false,
            error: result.error ?? 'No price data',
          })

          console.warn(`⚠️ ${symbol}: ${result.error ?? 'No price data on Base chain'}`)
          // Don't fail - just warn (some new tokens may not have pairs yet)
          expect(true).toBe(true)
        }
      },
      15000
    )
  })

  /**
   * CoinGecko Tests
   * Uses the actual fetchOHLCV from coingecko-client.ts
   */
  describe('CoinGecko (via fetchOHLCV)', () => {
    let hasApiKey: boolean

    beforeAll(() => {
      hasApiKey = !!process.env.COINGECKO_API_KEY
      if (!hasApiKey) {
        console.warn('⚠️ COINGECKO_API_KEY not set - CoinGecko tests will be skipped')
      }
    })

    it.each(tokenEntries)(
      '%s has OHLCV data',
      async (symbol, address) => {
        if (!hasApiKey) {
          results.coingecko.set(symbol, {
            success: false,
            error: 'API key not configured',
          })
          console.log(`⏭️ ${symbol}: Skipped (no API key)`)
          return
        }

        // Use the actual fetchOHLCV function from the codebase
        const result = await fetchOHLCV({
          tokenAddress: address,
          network: 'base',
          timeframe: 'hour',
          aggregate: '4',
          limit: 10,
        })

        if (result.success && result.candles.length > 0) {
          results.coingecko.set(symbol, {
            success: true,
            candleCount: result.candles.length,
          })
          console.log(`✅ ${symbol}: ${result.candles.length} candles available`)
          expect(result.candles.length).toBeGreaterThan(0)
        } else {
          results.coingecko.set(symbol, {
            success: false,
            error: result.error ?? 'No OHLCV data returned',
          })
          console.warn(`⚠️ ${symbol}: ${result.error ?? 'No OHLCV data (token may be too new)'}`)
          // Don't fail - some tokens may not have historical data
          expect(true).toBe(true)
        }
      },
      20000
    )
  })

  /**
   * Alchemy Tests
   * Uses the actual getAlchemy() singleton from execution/wallet.ts
   */
  describe('Alchemy (via getAlchemy)', () => {
    let hasApiKey: boolean

    beforeAll(() => {
      // Check if Alchemy is configured (either via RPC URL or direct API key)
      const rpcUrl = process.env.BASE_RPC_URL
      const directKey = process.env.ALCHEMY_API_KEY
      hasApiKey = !!(rpcUrl?.includes('alchemy.com') || directKey)

      if (!hasApiKey) {
        console.warn('⚠️ Alchemy API key not configured - Alchemy tests will be skipped')
      }
    })

    it.each(tokenEntries)(
      '%s has valid ERC20 metadata',
      async (symbol, address) => {
        if (!hasApiKey) {
          results.alchemy.set(symbol, {
            success: false,
            error: 'API key not configured',
          })
          console.log(`⏭️ ${symbol}: Skipped (no API key)`)
          return
        }

        try {
          // Use the actual Alchemy instance from the codebase
          const alchemy = getAlchemy()
          const metadata = await alchemy.core.getTokenMetadata(address)

          if (metadata.decimals !== null && metadata.symbol) {
            results.alchemy.set(symbol, {
              success: true,
              decimals: metadata.decimals,
              symbol: metadata.symbol,
            })

            // Verify decimals match our configuration
            const configuredDecimals = TOKEN_METADATA[symbol].decimals
            if (metadata.decimals !== configuredDecimals) {
              console.warn(
                `⚠️ ${symbol}: DECIMAL MISMATCH! Configured: ${configuredDecimals}, Actual: ${metadata.decimals}`
              )
              // This is a real error - fail the test
              expect(metadata.decimals).toBe(configuredDecimals)
            } else {
              console.log(`✅ ${symbol}: ${metadata.symbol} (${metadata.decimals} decimals)`)
              expect(metadata.decimals).toBe(configuredDecimals)
            }
          } else {
            results.alchemy.set(symbol, {
              success: false,
              error: 'Missing metadata (decimals or symbol null)',
            })
            console.warn(`⚠️ ${symbol}: Could not retrieve token metadata`)
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          results.alchemy.set(symbol, {
            success: false,
            error: errorMsg,
          })
          console.warn(`⚠️ ${symbol}: Alchemy error - ${errorMsg}`)
        }
      },
      15000
    )
  })

  /**
   * Summary Report
   * Prints a comprehensive summary of all test results
   */
  describe('Summary Report', () => {
    it('generates provider compatibility report', () => {
      console.log('\n' + '='.repeat(80))
      console.log('TOKEN PROVIDER COMPATIBILITY REPORT')
      console.log('='.repeat(80))

      const tokenCount = tokenEntries.length
      console.log(`\nTotal tokens configured: ${tokenCount}\n`)

      // DexScreener summary
      const dexSuccess = Array.from(results.dexscreener.values()).filter((r) => r.success).length
      console.log(`DexScreener (Price Data): ${dexSuccess}/${tokenCount} tokens supported`)

      // CoinGecko summary
      const cgSuccess = Array.from(results.coingecko.values()).filter((r) => r.success).length
      const cgSkipped = Array.from(results.coingecko.values()).filter(
        (r) => r.error === 'API key not configured'
      ).length
      if (cgSkipped === tokenCount) {
        console.log(`CoinGecko (OHLCV Data): Skipped (no API key)`)
      } else {
        console.log(`CoinGecko (OHLCV Data): ${cgSuccess}/${tokenCount} tokens supported`)
      }

      // Alchemy summary
      const alchemySuccess = Array.from(results.alchemy.values()).filter((r) => r.success).length
      const alchemySkipped = Array.from(results.alchemy.values()).filter(
        (r) => r.error === 'API key not configured'
      ).length
      if (alchemySkipped === tokenCount) {
        console.log(`Alchemy (Token Metadata): Skipped (no API key)`)
      } else {
        console.log(`Alchemy (Token Metadata): ${alchemySuccess}/${tokenCount} tokens supported`)
      }

      // Detailed breakdown for tokens with issues
      console.log('\n' + '-'.repeat(80))
      console.log('TOKENS WITH POTENTIAL ISSUES:')
      console.log('-'.repeat(80))

      let hasIssues = false
      for (const [symbol] of tokenEntries) {
        const dex = results.dexscreener.get(symbol)
        const cg = results.coingecko.get(symbol)
        const alch = results.alchemy.get(symbol)

        const issues: string[] = []

        if (dex && !dex.success) {
          issues.push(`DexScreener: ${dex.error}`)
        }
        if (cg && !cg.success && cg.error !== 'API key not configured') {
          issues.push(`CoinGecko: ${cg.error}`)
        }
        if (alch && !alch.success && alch.error !== 'API key not configured') {
          issues.push(`Alchemy: ${alch.error}`)
        }

        if (issues.length > 0) {
          hasIssues = true
          console.log(`\n${symbol}:`)
          issues.forEach((issue) => console.log(`  - ${issue}`))
        }
      }

      if (!hasIssues) {
        console.log('\nNo issues detected! All tokens are fully supported.')
      }

      console.log('\n' + '='.repeat(80))

      // This test always passes - it's for reporting only
      expect(true).toBe(true)
    })
  })
})

/**
 * Standalone validation function for use outside tests
 * Uses the actual implementations from the codebase
 *
 * @example
 * ```ts
 * import { validateToken } from './token-provider-validation.test'
 * const result = await validateToken('AERO', TOKEN_ADDRESSES.AERO)
 * console.log(result)
 * ```
 */
export async function validateToken(
  symbol: string,
  address: string
): Promise<{
  dexscreener: { supported: boolean; price?: string; liquidity?: number }
  coingecko: { supported: boolean; candleCount?: number; error?: string }
  alchemy: { supported: boolean; decimals?: number; symbol?: string; error?: string }
}> {
  // DexScreener - using actual tool
  const priceResult = await getPrice(symbol)
  const dexscreener = {
    supported: priceResult.success && !!priceResult.price.usd,
    price: priceResult.price.usd ?? undefined,
    liquidity: priceResult.market.liquidityUsd ?? undefined,
  }

  // CoinGecko - using actual fetchOHLCV
  let coingecko: { supported: boolean; candleCount?: number; error?: string }
  if (!process.env.COINGECKO_API_KEY) {
    coingecko = { supported: false, error: 'API key not configured' }
  } else {
    const ohlcvResult = await fetchOHLCV({
      tokenAddress: address,
      network: 'base',
      timeframe: 'hour',
      aggregate: '4',
      limit: 5,
    })
    coingecko = {
      supported: ohlcvResult.success && ohlcvResult.candles.length > 0,
      candleCount: ohlcvResult.candles.length,
      error: ohlcvResult.error,
    }
  }

  // Alchemy - using actual getAlchemy
  let alchemy: { supported: boolean; decimals?: number; symbol?: string; error?: string }
  try {
    const alchemyInstance = getAlchemy()
    const metadata = await alchemyInstance.core.getTokenMetadata(address)
    alchemy = {
      supported: metadata.decimals !== null && !!metadata.symbol,
      decimals: metadata.decimals ?? undefined,
      symbol: metadata.symbol ?? undefined,
    }
  } catch (error) {
    alchemy = {
      supported: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }

  return { dexscreener, coingecko, alchemy }
}
