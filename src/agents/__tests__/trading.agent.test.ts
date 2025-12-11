/**
 * Trading Agent - Integration Test
 * Verifies the inference provider is working correctly
 * Tests that the agent can call tools and reason about data
 *
 * SAFETY: The executeSwap tool is blocked in test mode via TEST_MODE env var.
 * Even if the agent tries to execute a swap, it will be blocked and return an error.
 *
 * NOTE: EigenAI's gpt-oss-120b-f16 model is tool-calling only and doesn't produce text.
 * Tests requiring text responses are skipped when LLM_PROVIDER=eigenai.
 */
import { describe, expect, it } from 'vitest'

import { executeSwapTool } from '../../tools/aerodrome/swap.tool'
import { aerodromeAgent } from '../trading.agent'

// Check if we're using EigenAI (which uses a tool-calling-only model)
const isEigenAI = process.env.LLM_PROVIDER === 'eigenai'

describe('Trading Agent - Safety Checks', () => {
  it('blocks swap execution via DRY_RUN by default', async () => {
    // DRY_RUN defaults to true unless explicitly set to 'false'
    // This provides safety in test environments

    // Try to execute a swap directly - should be blocked by DRY_RUN
    const result = await executeSwapTool.execute({
      context: {
        tokenIn: 'USDC',
        tokenOut: 'AERO',
        amountIn: '100',
        minAmountOut: '50',
        slippagePercent: 0.5,
      },
      runtimeContext: {} as never,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('DRY RUN')
    expect(result.error).toContain('NOT executed')

    console.log('Swap blocked with message:', result.error)
  })
})

describe('Trading Agent - Inference Provider', () => {
  // Skip text-response tests for EigenAI (gpt-oss-120b-f16 is tool-calling only)
  it.skipIf(isEigenAI)(
    'responds to a simple query without tool calls',
    async () => {
      const response = await aerodromeAgent.generate(
        'What tokens can you help me trade on Aerodrome? Just list the token names, no need to check prices.',
        { maxSteps: 1 }
      )

      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(0)

      // Should mention some tokens
      const text = response.text.toLowerCase()
      expect(
        text.includes('aero') ||
          text.includes('weth') ||
          text.includes('usdc') ||
          text.includes('eth')
      ).toBe(true)

      console.log('Agent response:', response.text.slice(0, 500))
    },
    60000
  )

  it('uses tools to gather data when asked about prices', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generate(
      'What is the current price of AERO? Use your tools to check.',
      {
        maxSteps: 3,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            // Handle both AI SDK format (toolName directly) and Mastra chunk format (payload.toolName)
            for (const t of toolCalls) {
              const tc = t as { toolName?: string; payload?: { toolName: string } }
              const name = tc.toolName ?? tc.payload?.toolName ?? 'unknown'
              toolsCalled.push(name)
            }
          }
        },
      }
    )

    // Should have called getTokenPrice tool
    expect(toolsCalled).toContain('getTokenPrice')

    // Text assertions only for non-EigenAI providers (gpt-oss-120b-f16 doesn't produce text)
    if (!isEigenAI) {
      expect(response.text).toBeDefined()
      const text = response.text.toLowerCase()
      expect(text.includes('price') || text.includes('$') || text.includes('usd')).toBe(true)
      console.log('Agent response:', response.text.slice(0, 500))
    }

    console.log('Tools called:', toolsCalled)
  }, 60000)

  it('checks wallet balance when asked about portfolio', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generate(
      'What is my current wallet balance? Check my ETH and token balances.',
      {
        maxSteps: 3,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            // Handle both AI SDK format (toolName directly) and Mastra chunk format (payload.toolName)
            for (const t of toolCalls) {
              const tc = t as { toolName?: string; payload?: { toolName: string } }
              const name = tc.toolName ?? tc.payload?.toolName ?? 'unknown'
              toolsCalled.push(name)
            }
          }
        },
      }
    )

    // Should have called getWalletBalance tool
    expect(toolsCalled).toContain('getWalletBalance')

    // Text assertions only for non-EigenAI providers
    if (!isEigenAI) {
      expect(response.text).toBeDefined()
      console.log('Agent response:', response.text.slice(0, 500))
    }

    console.log('Tools called:', toolsCalled)
  }, 60000)

  it('gathers multiple data sources for trading analysis', async () => {
    const toolsCalled: string[] = []

    const response = await aerodromeAgent.generate(
      'Analyze AERO/USDC for a potential trade. Check the price, pool metrics, and give me your analysis. Do NOT execute any trades.',
      {
        maxSteps: 5,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls?.length) {
            // Handle both AI SDK format (toolName directly) and Mastra chunk format (payload.toolName)
            for (const t of toolCalls) {
              const tc = t as { toolName?: string; payload?: { toolName: string } }
              const name = tc.toolName ?? tc.payload?.toolName ?? 'unknown'
              toolsCalled.push(name)
            }
          }
        },
      }
    )

    // Should have called multiple tools for comprehensive analysis
    expect(toolsCalled.length).toBeGreaterThanOrEqual(2)

    // Should NOT have called executeSwap (we said don't trade)
    expect(toolsCalled).not.toContain('executeSwap')

    // Text assertions only for non-EigenAI providers
    if (!isEigenAI) {
      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(100)
      console.log('Agent response:', response.text.slice(0, 800))
    }

    console.log('Tools called:', toolsCalled)
  }, 90000)

  // Skip JSON response test for EigenAI (gpt-oss-120b-f16 doesn't produce text)
  it.skipIf(isEigenAI)(
    'returns structured JSON decision when asked',
    async () => {
      const response = await aerodromeAgent.generate(
        `Based on the following hypothetical data, provide your trading decision as JSON:
      - AERO price: $1.50, up 5% in 24h
      - Pool liquidity: $10M
      - Sentiment: Moderately bullish
      - My balance: 1000 USDC
      
      Give me your decision in the JSON format from your output contract.`,
        { maxSteps: 1 }
      )

      expect(response.text).toBeDefined()

      // Should contain JSON structure
      expect(response.text.includes('reasoning') || response.text.includes('trade_decisions')).toBe(
        true
      )

      console.log('Agent JSON response:', response.text)
    },
    60000
  )
})
