/**
 * Aerodrome Quote Tool
 * Returns raw swap quote data from Aerodrome Router
 * No interpretation - agent decides what the data means
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import { AERODROME_CONTRACTS, AERODROME_ROUTER_ABI, createRoute } from '../../config/contracts.js'
import { resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { getProvider } from '../../execution/wallet.js'

export const getQuoteTool = createTool({
  id: 'aerodrome-get-quote',
  description: `Get a swap quote from Aerodrome DEX on Base chain.
Returns expected output amount and route information.
Use this to check swap prices before executing trades.`,

  inputSchema: z.object({
    tokenIn: z.string().describe("Input token symbol (e.g., 'WETH', 'USDC') or address"),
    tokenOut: z.string().describe("Output token symbol (e.g., 'AERO', 'USDC') or address"),
    amountIn: z.string().describe("Amount to swap in human-readable format (e.g., '1.5')"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    tokenIn: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      amountIn: z.string(),
      amountInRaw: z.string(),
    }),
    tokenOut: z.object({
      symbol: z.string(),
      address: z.string(),
      decimals: z.number(),
      amountOut: z.string(),
      amountOutRaw: z.string(),
    }),
    route: z.object({
      path: z.array(z.string()),
      stable: z.boolean(),
    }),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenIn, tokenOut, amountIn } = context

    try {
      const tokenInMeta = resolveToken(tokenIn)
      const tokenOutMeta = resolveToken(tokenOut)

      if (!tokenInMeta || !tokenOutMeta) {
        return {
          success: false,
          tokenIn: { symbol: tokenIn, address: '', decimals: 0, amountIn: '0', amountInRaw: '0' },
          tokenOut: {
            symbol: tokenOut,
            address: '',
            decimals: 0,
            amountOut: '0',
            amountOutRaw: '0',
          },
          route: { path: [], stable: false },
          error: `Unknown token: ${!tokenInMeta ? tokenIn : tokenOut}`,
        }
      }

      const isStable = shouldUseStablePool(tokenIn, tokenOut)
      const amountInRaw = ethers.parseUnits(amountIn, tokenInMeta.decimals)
      const route = createRoute(tokenInMeta.address, tokenOutMeta.address, isStable)

      const provider = getProvider()
      const router = new ethers.Contract(
        AERODROME_CONTRACTS.ROUTER_V2,
        AERODROME_ROUTER_ABI,
        provider
      )

      const amounts = await router.getAmountsOut(amountInRaw, [route])
      const amountOutRaw = amounts[amounts.length - 1]
      const amountOut = ethers.formatUnits(amountOutRaw, tokenOutMeta.decimals)

      return {
        success: true,
        tokenIn: {
          symbol: tokenInMeta.symbol,
          address: tokenInMeta.address,
          decimals: tokenInMeta.decimals,
          amountIn,
          amountInRaw: amountInRaw.toString(),
        },
        tokenOut: {
          symbol: tokenOutMeta.symbol,
          address: tokenOutMeta.address,
          decimals: tokenOutMeta.decimals,
          amountOut,
          amountOutRaw: amountOutRaw.toString(),
        },
        route: {
          path: [tokenInMeta.symbol, tokenOutMeta.symbol],
          stable: isStable,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        tokenIn: { symbol: tokenIn, address: '', decimals: 0, amountIn: '0', amountInRaw: '0' },
        tokenOut: { symbol: tokenOut, address: '', decimals: 0, amountOut: '0', amountOutRaw: '0' },
        route: { path: [], stable: false },
        error: errorMessage,
      }
    }
  },
})
