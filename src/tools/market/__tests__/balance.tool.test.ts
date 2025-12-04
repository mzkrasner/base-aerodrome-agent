/**
 * Wallet Balance Tool - Integration Test
 * Checks real wallet balances on Base chain
 */
import { describe, expect, it } from 'vitest'

import { getWalletBalanceTool } from '../balance.tool'

const getBalance = (tokens?: string[]) =>
  getWalletBalanceTool.execute({
    context: { tokens },
    runtimeContext: {} as never,
  })

describe('Wallet Balance Tool', () => {
  it('returns wallet address and default token balances', async () => {
    const result = await getBalance()

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Should have wallet address
    expect(result.walletAddress).toBeDefined()
    expect(result.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Should have ETH + default tokens (WETH, USDC, AERO)
    expect(result.balances.length).toBeGreaterThanOrEqual(4)

    // ETH should always be first
    expect(result.balances[0].symbol).toBe('ETH')

    console.log('Wallet:', result.walletAddress)
    result.balances.forEach((b) => {
      console.log(`  ${b.symbol}: ${b.balance}`)
    })
  }, 15000)

  it('returns correct balance structure', async () => {
    const result = await getBalance()

    expect(result.success).toBe(true)

    for (const balance of result.balances) {
      // Each balance should have all required fields
      expect(balance.symbol).toBeDefined()
      expect(balance.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(typeof balance.balance).toBe('string')
      expect(typeof balance.balanceRaw).toBe('string')
      expect(typeof balance.decimals).toBe('number')

      // Balance should be a valid number string
      const balanceNum = parseFloat(balance.balance)
      expect(isNaN(balanceNum)).toBe(false)
      expect(balanceNum).toBeGreaterThanOrEqual(0)
    }
  }, 15000)

  it('fetches specific tokens when requested', async () => {
    const result = await getBalance(['USDC', 'AERO'])

    expect(result.success).toBe(true)

    // Should have ETH (always included) + requested tokens
    const symbols = result.balances.map((b) => b.symbol)
    expect(symbols).toContain('ETH')
    expect(symbols).toContain('USDC')
    expect(symbols).toContain('AERO')

    // Should NOT have WETH since we didn't request it
    expect(symbols).not.toContain('WETH')

    console.log('Requested tokens:', symbols)
  }, 15000)

  it('returns raw balance for precise calculations', async () => {
    const result = await getBalance(['USDC'])

    expect(result.success).toBe(true)

    const usdcBalance = result.balances.find((b) => b.symbol === 'USDC')
    expect(usdcBalance).toBeDefined()

    if (usdcBalance) {
      // USDC has 6 decimals
      expect(usdcBalance.decimals).toBe(6)

      // Raw balance should be an integer string
      expect(usdcBalance.balanceRaw).toMatch(/^\d+$/)

      console.log('USDC:', {
        formatted: usdcBalance.balance,
        raw: usdcBalance.balanceRaw,
        decimals: usdcBalance.decimals,
      })
    }
  }, 15000)

  it('handles unknown tokens gracefully', async () => {
    const result = await getBalance(['USDC', 'UNKNOWNTOKEN', 'AERO'])

    // Should still succeed, just skip unknown tokens
    expect(result.success).toBe(true)

    const symbols = result.balances.map((b) => b.symbol)
    expect(symbols).toContain('USDC')
    expect(symbols).toContain('AERO')
    expect(symbols).not.toContain('UNKNOWNTOKEN')
  }, 15000)
})
