/**
 * Aerodrome Quote Tool - Integration Test
 * Calls actual Aerodrome Router contract on Base chain
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '@/config/tokens'

import { getQuoteTool } from '../quote.tool'

const getQuote = (tokenIn: string, tokenOut: string, amountIn: string) =>
  getQuoteTool.execute({
    context: { tokenIn, tokenOut, amountIn },
    runtimeContext: {} as never,
  })

describe('Aerodrome Quote Tool', () => {
  it('gets quote for USDC -> AERO (volatile pool)', async () => {
    const result = await getQuote('USDC', 'AERO', '100')

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Token metadata
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenIn.address).toBe(TOKEN_ADDRESSES.USDC)
    expect(result.tokenIn.decimals).toBe(6)
    expect(result.tokenIn.amountIn).toBe('100')

    expect(result.tokenOut.symbol).toBe('AERO')
    expect(result.tokenOut.address).toBe(TOKEN_ADDRESSES.AERO)
    expect(result.tokenOut.decimals).toBe(18)

    // Should get some AERO output
    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    // Route should be volatile (USDC/AERO is not stable pair)
    expect(result.route.stable).toBe(false)
    expect(result.route.path).toEqual(['USDC', 'AERO'])

    console.log('100 USDC =', result.tokenOut.amountOut, 'AERO')
  }, 15000)

  it('gets quote for WETH -> USDC (volatile pool)', async () => {
    const result = await getQuote('WETH', 'USDC', '0.1')

    expect(result.success).toBe(true)

    expect(result.tokenIn.symbol).toBe('WETH')
    expect(result.tokenIn.decimals).toBe(18)

    expect(result.tokenOut.symbol).toBe('USDC')
    expect(result.tokenOut.decimals).toBe(6)

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    // Should be roughly $300 for 0.1 ETH at current prices
    expect(amountOut).toBeGreaterThan(100)
    expect(amountOut).toBeLessThan(1000)

    console.log('0.1 WETH =', result.tokenOut.amountOut, 'USDC')
  }, 15000)

  it('returns raw amounts for precise calculations', async () => {
    const result = await getQuote('USDC', 'AERO', '100')

    expect(result.success).toBe(true)

    // amountInRaw should be 100 * 10^6 (USDC has 6 decimals)
    expect(result.tokenIn.amountInRaw).toBe('100000000')

    // amountOutRaw should be a large number (AERO has 18 decimals)
    const amountOutRaw = BigInt(result.tokenOut.amountOutRaw)
    expect(amountOutRaw).toBeGreaterThan(0n)

    console.log('Raw amounts:', {
      in: result.tokenIn.amountInRaw,
      out: result.tokenOut.amountOutRaw,
    })
  }, 15000)

  it('handles unknown token gracefully', async () => {
    const result = await getQuote('UNKNOWNTOKEN', 'USDC', '100')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })

  it('accepts token addresses instead of symbols', async () => {
    const result = await getQuote(TOKEN_ADDRESSES.USDC, TOKEN_ADDRESSES.AERO, '100')

    expect(result.success).toBe(true)
    expect(result.tokenIn.symbol).toBe('USDC')
    expect(result.tokenOut.symbol).toBe('AERO')

    const amountOut = parseFloat(result.tokenOut.amountOut)
    expect(amountOut).toBeGreaterThan(0)

    console.log('100 USDC (by address) =', result.tokenOut.amountOut, 'AERO')
  }, 15000)
})
