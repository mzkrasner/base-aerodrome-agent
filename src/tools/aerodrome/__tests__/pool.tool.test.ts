/**
 * Aerodrome Pool Metrics Tool - Integration Test
 * Tests real pool data fetching from Aerodrome on Base chain
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '../../../config/tokens'
import { getPoolMetricsTool } from '../pool.tool'

const getPoolMetrics = (tokenA: string, tokenB: string) =>
  getPoolMetricsTool.execute({
    context: { tokenA, tokenB },
    runtimeContext: {} as never,
  })

describe('Aerodrome Pool Metrics Tool', () => {
  it('gets pool metrics for WETH/USDC (volatile pool)', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Pool should exist and have an address
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // WETH/USDC is a volatile pool
    expect(result.isStable).toBe(false)

    // Tokens should be correctly identified
    const symbols = [result.token0.symbol, result.token1.symbol]
    expect(symbols).toContain('WETH')
    expect(symbols).toContain('USDC')

    // Reserves should be positive numbers
    const reserve0 = parseFloat(result.token0.reserve)
    const reserve1 = parseFloat(result.token1.reserve)
    expect(reserve0).toBeGreaterThan(0)
    expect(reserve1).toBeGreaterThan(0)

    console.log('WETH/USDC Pool:', result.poolAddress)
    console.log(`  ${result.token0.symbol}: ${result.token0.reserve}`)
    console.log(`  ${result.token1.symbol}: ${result.token1.reserve}`)
  }, 30000)

  it('gets pool metrics for USDC/AERO (volatile pool)', async () => {
    const result = await getPoolMetrics('USDC', 'AERO')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(result.isStable).toBe(false)

    const symbols = [result.token0.symbol, result.token1.symbol]
    expect(symbols).toContain('USDC')
    expect(symbols).toContain('AERO')

    console.log('USDC/AERO Pool:', result.poolAddress)
    console.log(`  ${result.token0.symbol}: ${result.token0.reserve}`)
    console.log(`  ${result.token1.symbol}: ${result.token1.reserve}`)
  }, 30000)

  it('returns correct token decimals', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)

    // Find WETH and USDC in results
    const wethToken = result.token0.symbol === 'WETH' ? result.token0 : result.token1
    const usdcToken = result.token0.symbol === 'USDC' ? result.token0 : result.token1

    // WETH has 18 decimals
    expect(wethToken.decimals).toBe(18)

    // USDC has 6 decimals
    expect(usdcToken.decimals).toBe(6)

    console.log('Decimals:', {
      WETH: wethToken.decimals,
      USDC: usdcToken.decimals,
    })
  }, 30000)

  it('returns raw reserves for precise calculations', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)

    // Raw reserves should be integer strings
    expect(result.token0.reserveRaw).toMatch(/^\d+$/)
    expect(result.token1.reserveRaw).toMatch(/^\d+$/)

    // Raw should be much larger than formatted (due to decimals)
    const rawNum = BigInt(result.token0.reserveRaw)
    expect(rawNum).toBeGreaterThan(0n)

    console.log('Raw reserves:', {
      token0: result.token0.reserveRaw,
      token1: result.token1.reserveRaw,
    })
  }, 30000)

  it('returns correct token addresses', async () => {
    const result = await getPoolMetrics('WETH', 'USDC')

    expect(result.success).toBe(true)

    // Addresses should match our config
    const addresses = [result.token0.address.toLowerCase(), result.token1.address.toLowerCase()]
    expect(addresses).toContain(TOKEN_ADDRESSES.WETH.toLowerCase())
    expect(addresses).toContain(TOKEN_ADDRESSES.USDC.toLowerCase())
  }, 30000)

  it('handles unknown token gracefully', async () => {
    const result = await getPoolMetrics('UNKNOWNTOKEN', 'USDC')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })

  it('accepts token addresses instead of symbols', async () => {
    const result = await getPoolMetrics(TOKEN_ADDRESSES.WETH, TOKEN_ADDRESSES.USDC)

    expect(result.success).toBe(true)
    expect(result.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    const symbols = [result.token0.symbol, result.token1.symbol]
    expect(symbols).toContain('WETH')
    expect(symbols).toContain('USDC')

    console.log('Pool by address:', result.poolAddress)
  }, 30000)
})
