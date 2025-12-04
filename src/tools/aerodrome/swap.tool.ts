/**
 * Aerodrome Swap Execution Tool
 * Executes token swaps on Aerodrome Router
 * Returns raw transaction result
 *
 * SAFETY: Trades are blocked when:
 * - DRY_RUN=true (recommended for testing)
 * - TEST_MODE=true
 * - NODE_ENV=test
 * - No AGENT_PRIVATE_KEY configured
 */
import { createTool } from '@mastra/core/tools'
import { ethers } from 'ethers'
import { z } from 'zod'

import { AERODROME_CONTRACTS, AERODROME_ROUTER_ABI, createRoute } from '../../config/contracts.js'
import { ENV_CONFIG, TRADING_CONFIG } from '../../config/index.js'
import { TOKEN_ADDRESSES, resolveToken, shouldUseStablePool } from '../../config/tokens.js'
import { approveToken, getWallet, isWalletConfigured } from '../../execution/wallet.js'

export const executeSwapTool = createTool({
  id: 'aerodrome-execute-swap',
  description: `Execute a token swap on Aerodrome DEX.
Only call this when you have decided to trade AND you are confident.
Requires wallet to be configured with AGENT_PRIVATE_KEY.
NOTE: Trades are blocked in DRY_RUN mode - the tool will return an error instead of executing.`,

  inputSchema: z.object({
    tokenIn: z.string().describe('Input token symbol or address'),
    tokenOut: z.string().describe('Output token symbol or address'),
    amountIn: z.string().describe('Amount to swap in human-readable format'),
    minAmountOut: z.string().describe('Minimum acceptable output amount'),
    slippagePercent: z.number().default(0.5).describe('Slippage tolerance percentage'),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    txHash: z.string().optional(),
    tokenIn: z.object({
      symbol: z.string(),
      amount: z.string(),
    }),
    tokenOut: z.object({
      symbol: z.string(),
      amountExpected: z.string(),
      amountMin: z.string(),
    }),
    gasUsed: z.string().optional(),
    error: z.string().optional(),
    dryRun: z.boolean().optional(),
  }),

  execute: async ({ context }) => {
    const { tokenIn, tokenOut, amountIn, minAmountOut } = context

    // SAFETY: Block execution in dry run / test mode to prevent accidental trades
    if (ENV_CONFIG.dryRun || ENV_CONFIG.isTest) {
      console.log(
        `🚫 [DRY RUN] Would swap ${amountIn} ${tokenIn} → ${tokenOut} (min: ${minAmountOut})`
      )
      return {
        success: false,
        dryRun: true,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: minAmountOut, amountMin: minAmountOut },
        error:
          'DRY RUN: Trade was simulated but NOT executed. Set DRY_RUN=false to enable real trades.',
      }
    }

    // Check wallet configuration
    if (!isWalletConfigured()) {
      return {
        success: false,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
        error: 'Wallet not configured. Set AGENT_PRIVATE_KEY environment variable.',
      }
    }

    try {
      const tokenInMeta = resolveToken(tokenIn)
      const tokenOutMeta = resolveToken(tokenOut)

      if (!tokenInMeta || !tokenOutMeta) {
        return {
          success: false,
          tokenIn: { symbol: tokenIn, amount: amountIn },
          tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
          error: `Unknown token: ${!tokenInMeta ? tokenIn : tokenOut}`,
        }
      }

      const wallet = getWallet()
      const isStable = shouldUseStablePool(tokenIn, tokenOut)
      const amountInRaw = ethers.parseUnits(amountIn, tokenInMeta.decimals)
      const minAmountOutRaw = ethers.parseUnits(minAmountOut, tokenOutMeta.decimals)

      const route = createRoute(tokenInMeta.address, tokenOutMeta.address, isStable)
      const deadline = Math.floor(Date.now() / 1000) + TRADING_CONFIG.txDeadlineSeconds

      const router = new ethers.Contract(
        AERODROME_CONTRACTS.ROUTER_V2,
        AERODROME_ROUTER_ABI,
        wallet
      )

      let tx: ethers.ContractTransactionResponse

      // Check if swapping from native ETH
      const isFromETH = tokenInMeta.address.toLowerCase() === TOKEN_ADDRESSES.WETH.toLowerCase()

      if (isFromETH) {
        // Swap ETH for tokens
        const swapEthFn = router.getFunction('swapExactETHForTokens')
        tx = (await swapEthFn(minAmountOutRaw, [route], wallet.address, deadline, {
          value: amountInRaw,
        })) as ethers.ContractTransactionResponse
      } else {
        // Approve token spending if needed
        await approveToken(tokenInMeta.address, AERODROME_CONTRACTS.ROUTER_V2, amountInRaw)

        // Check if swapping to native ETH
        const isToETH = tokenOutMeta.address.toLowerCase() === TOKEN_ADDRESSES.WETH.toLowerCase()

        if (isToETH) {
          const swapToEthFn = router.getFunction('swapExactTokensForETH')
          tx = (await swapToEthFn(
            amountInRaw,
            minAmountOutRaw,
            [route],
            wallet.address,
            deadline
          )) as ethers.ContractTransactionResponse
        } else {
          const swapTokensFn = router.getFunction('swapExactTokensForTokens')
          tx = (await swapTokensFn(
            amountInRaw,
            minAmountOutRaw,
            [route],
            wallet.address,
            deadline
          )) as ethers.ContractTransactionResponse
        }
      }

      const receipt = await tx.wait()

      return {
        success: true,
        txHash: receipt?.hash,
        tokenIn: {
          symbol: tokenInMeta.symbol,
          amount: amountIn,
        },
        tokenOut: {
          symbol: tokenOutMeta.symbol,
          amountExpected: minAmountOut,
          amountMin: minAmountOut,
        },
        gasUsed: receipt?.gasUsed?.toString(),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        tokenIn: { symbol: tokenIn, amount: amountIn },
        tokenOut: { symbol: tokenOut, amountExpected: '0', amountMin: minAmountOut },
        error: errorMessage,
      }
    }
  },
})
