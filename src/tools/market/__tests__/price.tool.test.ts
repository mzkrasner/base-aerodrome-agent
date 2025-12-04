/**
 * Token Price Tool - Integration Test
 * Calls actual DexScreener API
 */
import { describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '@/config/tokens'

import { getTokenPriceTool } from '../price.tool'

// Helper to call tool without boilerplate
const getPrice = (token: string) =>
  getTokenPriceTool.execute({
    context: { token },
    runtimeContext: {} as never,
  })

describe('Token Price Tool', () => {
  it('fetches price by symbol (AERO)', async () => {
    const result = await getPrice('AERO')

    expect(result.success).toBe(true)
    expect(result.token.symbol).toBe('AERO')
    expect(result.token.address).toBe(TOKEN_ADDRESSES.AERO)
    expect(result.price.usd).toBeDefined()

    console.log('AERO:', result.price.usd, 'USD')
  }, 10000)

  it('fetches price by symbol (WETH)', async () => {
    const result = await getPrice('WETH')

    expect(result.success).toBe(true)
    expect(result.token.symbol).toBe('WETH')
    expect(result.token.address).toBe(TOKEN_ADDRESSES.WETH)
    expect(result.price.usd).toBeDefined()

    console.log('WETH:', result.price.usd, 'USD')
  }, 10000)

  it('fetches price by raw address', async () => {
    const result = await getPrice(TOKEN_ADDRESSES.AERO)

    expect(result.success).toBe(true)
    expect(result.token.symbol).toBe('AERO')
    expect(result.token.address).toBe(TOKEN_ADDRESSES.AERO)
    expect(result.price.usd).toBeDefined()

    console.log('AERO (by address):', result.price.usd, 'USD')
  }, 10000)

  it('returns market data (volume, liquidity, fdv)', async () => {
    const result = await getPrice('AERO')

    expect(result.success).toBe(true)
    expect(result.market.volume24hUsd).toBeDefined()
    expect(result.market.liquidityUsd).toBeDefined()
    expect(result.market.fdv).toBeDefined()
    expect(typeof result.market.volume24hUsd).toBe('number')
    expect(typeof result.market.liquidityUsd).toBe('number')

    console.log('Volume 24h:', result.market.volume24hUsd)
    console.log('Liquidity:', result.market.liquidityUsd)
    console.log('FDV:', result.market.fdv)
  }, 10000)

  it('returns 24h price change', async () => {
    const result = await getPrice('AERO')

    expect(result.success).toBe(true)
    expect(result.price.change24hPercent).toBeDefined()
    expect(typeof result.price.change24hPercent).toBe('number')

    console.log('24h Change:', result.price.change24hPercent, '%')
  }, 10000)

  it('handles unknown token gracefully', async () => {
    const result = await getPrice('UNKNOWNTOKEN123')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })

  it('handles unknown address gracefully', async () => {
    const result = await getPrice('0x0000000000000000000000000000000000000001')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown token')
  })
})
