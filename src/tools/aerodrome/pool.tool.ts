/**
 * Aerodrome Pool Metrics Tool
 * Returns raw pool data - reserves, TVL, etc.
 * No interpretation - agent decides what the data means
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import {
  AERODROME_CONTRACTS,
  AERODROME_POOL_ABI,
  AERODROME_ROUTER_ABI,
} from '../../config/contracts.js'
import { resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { getProvider } from '../../execution/wallet.js'

export const getPoolMetricsTool = createTool({
  id: 'aerodrome-pool-metrics',
  description: `Get raw liquidity pool data from Aerodrome DEX.
Returns reserves, TVL estimate, and pool configuration.
Use this to assess pool depth before trading.`,

  inputSchema: z.object({
    tokenA: z.string().describe("First token symbol (e.g., 'WETH') or address"),
    tokenB: z.string().describe("Second token symbol (e.g., 'USDC') or address"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    poolAddress: z.string(),
    isStable: z.boolean(),
    token0: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      reserve: z.string(),
      reserveRaw: z.string(),
    }),
    token1: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      reserve: z.string(),
      reserveRaw: z.string(),
    }),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenA, tokenB } = context

    try {
      const tokenAMeta = resolveToken(tokenA)
      const tokenBMeta = resolveToken(tokenB)

      if (!tokenAMeta || !tokenBMeta) {
        return {
          success: false,
          poolAddress: '',
          isStable: false,
          token0: { symbol: '', address: '', decimals: 0, reserve: '0', reserveRaw: '0' },
          token1: { symbol: '', address: '', decimals: 0, reserve: '0', reserveRaw: '0' },
          error: `Unknown token: ${!tokenAMeta ? tokenA : tokenB}`,
        }
      }

      const isStable = shouldUseStablePool(tokenA, tokenB)
      const provider = getProvider()

      const router = new ethers.Contract(
        AERODROME_CONTRACTS.ROUTER_V2,
        AERODROME_ROUTER_ABI,
        provider
      )

      const poolAddress = await router.poolFor(
        tokenAMeta.address,
        tokenBMeta.address,
        isStable,
        AERODROME_CONTRACTS.POOL_FACTORY
      )

      if (poolAddress === ethers.ZeroAddress) {
        return {
          success: false,
          poolAddress: '',
          isStable,
          token0: {
            symbol: tokenAMeta.symbol,
            address: tokenAMeta.address,
            decimals: tokenAMeta.decimals,
            reserve: '0',
            reserveRaw: '0',
          },
          token1: {
            symbol: tokenBMeta.symbol,
            address: tokenBMeta.address,
            decimals: tokenBMeta.decimals,
            reserve: '0',
            reserveRaw: '0',
          },
          error: `No ${isStable ? 'stable' : 'volatile'} pool found`,
        }
      }

      const pool = new ethers.Contract(poolAddress, AERODROME_POOL_ABI, provider)
      const [reserve0Raw, reserve1Raw] = await pool.getReserves()
      const token0Address = await pool.token0()

      // Determine which token is token0 vs token1
      const token0IsA = token0Address.toLowerCase() === tokenAMeta.address.toLowerCase()

      const token0Meta = token0IsA ? tokenAMeta : tokenBMeta
      const token1Meta = token0IsA ? tokenBMeta : tokenAMeta

      return {
        success: true,
        poolAddress,
        isStable,
        token0: {
          symbol: token0Meta.symbol,
          address: token0Meta.address,
          decimals: token0Meta.decimals,
          reserve: ethers.formatUnits(reserve0Raw, token0Meta.decimals),
          reserveRaw: reserve0Raw.toString(),
        },
        token1: {
          symbol: token1Meta.symbol,
          address: token1Meta.address,
          decimals: token1Meta.decimals,
          reserve: ethers.formatUnits(reserve1Raw, token1Meta.decimals),
          reserveRaw: reserve1Raw.toString(),
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        poolAddress: '',
        isStable: false,
        token0: { symbol: '', address: '', decimals: 0, reserve: '0', reserveRaw: '0' },
        token1: { symbol: '', address: '', decimals: 0, reserve: '0', reserveRaw: '0' },
        error: errorMessage,
      }
    }
  },
})
