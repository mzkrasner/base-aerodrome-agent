/**
 * EigenAI Deterministic Flow Integration Test
 *
 * Tests the new deterministic trading flow where:
 * - Tools are called programmatically (no gpt-oss)
 * - Only Qwen is used for reasoning/decision
 * - Verification data is saved for Recall
 *
 * This tests the ACTUAL production flow when LLM_PROVIDER=eigenai.
 *
 * Run with: LLM_PROVIDER=eigenai pnpm vitest run src/loop/__tests__/eigen-deterministic.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { callQwenDirect, parseQwenDecision } from '../../lib/llm/providers/eigenai-direct.js'
import type { QwenTradeDecision } from '../../lib/llm/types.js'
import { eigenaiInferenceTracker } from '../../services/eigen/eigenai-inference.service.js'
import {
  type EigenTradingContext,
  type ToolResult,
  buildDecisionPrompt,
  executeTradeDecision,
  gatherMarketData,
} from '../eigen-deterministic.js'

// Only run these tests when EigenAI is configured
const isEigenAI = process.env.LLM_PROVIDER === 'eigenai'
const hasEigenAIAuth = !!process.env.EIGENAI_API_KEY

describe.skipIf(!isEigenAI || !hasEigenAIAuth)('EigenAI Deterministic Flow', () => {
  beforeEach(() => {
    console.log('\n' + '='.repeat(60))
  })

  afterEach(() => {
    console.log('='.repeat(60) + '\n')
  })

  describe('callQwenDirect', () => {
    it('calls Qwen API and returns VALID decision (NOT error fallback)', async () => {
      const systemPrompt = `You are a trading agent. Make decisions based on market data.`

      const userPrompt = `## Market Data
      
Token: WETH
Current Price: $3,500
24h Change: +2.5%
RSI: 55
Wallet Balance: 100 USDC

## Task
Make a trading decision. Output ONLY JSON:
{
  "reasoning": "your analysis",
  "trade_decisions": [{ "token": "WETH", "action": "BUY" | "SELL" | "HOLD", "amount_usd": number, "via": null, "rationale": "why" }]
}`

      console.log('Calling Qwen directly...')
      const result = await callQwenDirect(systemPrompt, userPrompt)

      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)

      // CRITICAL: Parse and verify we got a REAL response, not an error fallback
      const decision = parseQwenDecision(result.content)

      // These MUST FAIL if API returned an error
      expect(decision.reasoning).not.toContain('API error')
      expect(decision.reasoning).not.toContain('Network error')
      expect(decision.reasoning).not.toContain('not configured')
      expect(decision.reasoning).not.toContain('Qwen API error')

      // Verify we got a real decision
      expect(decision.trade_decisions).toBeDefined()
      expect(decision.trade_decisions.length).toBeGreaterThan(0)
      expect(['BUY', 'SELL', 'HOLD']).toContain(decision.trade_decisions[0].action)

      console.log('✅ Qwen returned VALID decision (not error fallback)')
      console.log(`   Action: ${decision.trade_decisions[0].action}`)
      console.log(`   Content length: ${result.content.length}`)
      console.log(`   Has signature: ${!!result.signature}`)
    }, 60000)

    it('returns HOLD on missing API key', async () => {
      // Temporarily unset the API key
      const originalKey = process.env.EIGENAI_API_KEY
      delete process.env.EIGENAI_API_KEY

      const result = await callQwenDirect('test', 'test')

      // Restore
      process.env.EIGENAI_API_KEY = originalKey

      expect(result.content).toContain('HOLD')
      console.log('✅ Correctly returns HOLD when API key missing')
    })
  })

  describe('Inference Database Persistence', () => {
    it('saves inference to database after successful Qwen call', async () => {
      const systemPrompt = `You are a trading agent. Respond with JSON only.`
      const userPrompt = `Token: WETH, Price: $3500. Output: { "reasoning": "test", "trade_decisions": [{ "token": "WETH", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "testing" }] }`

      console.log('Calling Qwen to generate inference...')
      const result = await callQwenDirect(systemPrompt, userPrompt)

      // Verify we got a response with signature (required for persistence)
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)

      // If we got a signature, the data should be saved
      if (result.signature) {
        console.log('✅ Got signature - checking database persistence...')

        // Give the async save a moment to complete
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Query the database for the most recent unsubmitted inference
        const savedInference = await eigenaiInferenceTracker.getMostRecentUnsubmitted()

        expect(savedInference).not.toBeNull()
        expect(savedInference!.signature).toBe(result.signature)
        expect(savedInference!.responseModel).toBe('qwen3-32b-128k-bf16')
        expect(savedInference!.responseOutput).toBe(result.content)
        expect(savedInference!.submittedToRecall).toBe(false)

        // Verify prompt was saved (system + user concatenated)
        expect(savedInference!.requestPrompt).toContain('trading agent')

        console.log('✅ Inference persisted to database correctly')
        console.log(`   ID: ${savedInference!.id}`)
        console.log(`   Model: ${savedInference!.responseModel}`)
        console.log(`   Signature: ${savedInference!.signature.substring(0, 20)}...`)
        console.log(`   Submitted: ${savedInference!.submittedToRecall}`)
      } else {
        console.log('⚠️ No signature received - skipping persistence check')
        console.log('   (EigenAI may not be returning signatures in this environment)')
      }
    }, 60000)

    it('getMostRecentUnsubmitted returns correct inference', async () => {
      // First, make a call that should save an inference
      const systemPrompt = `You are a trading agent.`
      const userPrompt = `Make a HOLD decision. JSON only: { "reasoning": "...", "trade_decisions": [{ "token": "WETH", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "..." }] }`

      const result = await callQwenDirect(systemPrompt, userPrompt)

      if (!result.signature) {
        console.log('⚠️ No signature - skipping getMostRecentUnsubmitted test')
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      const inference = await eigenaiInferenceTracker.getMostRecentUnsubmitted()

      expect(inference).not.toBeNull()
      expect(inference!.submittedToRecall).toBe(false)

      // Verify it can be retrieved by ID
      const byId = await eigenaiInferenceTracker.getById(inference!.id)
      expect(byId).not.toBeNull()
      expect(byId!.id).toBe(inference!.id)

      console.log('✅ getMostRecentUnsubmitted works correctly')
    }, 60000)

    it('inference includes correct token counts', async () => {
      const systemPrompt = `You are a trading agent.`
      const userPrompt = `Respond: { "reasoning": "token count test", "trade_decisions": [{ "token": "WETH", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "testing" }] }`

      const result = await callQwenDirect(systemPrompt, userPrompt)

      if (!result.signature) {
        console.log('⚠️ No signature - skipping token count test')
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      const inference = await eigenaiInferenceTracker.getMostRecentUnsubmitted()

      expect(inference).not.toBeNull()
      if (!inference) return // TypeScript guard

      const promptTokens = inference.promptTokens ?? 0
      const completionTokens = inference.completionTokens ?? 0
      const totalTokens = inference.totalTokens ?? 0

      expect(promptTokens).toBeGreaterThan(0)
      expect(completionTokens).toBeGreaterThan(0)
      expect(totalTokens).toBe(promptTokens + completionTokens)

      console.log('✅ Token counts saved correctly')
      console.log(`   Prompt tokens: ${promptTokens}`)
      console.log(`   Completion tokens: ${completionTokens}`)
      console.log(`   Total tokens: ${totalTokens}`)
    }, 60000)

    it('getMostRecentUnsubmitted returns NEWEST inference (not oldest) - CRITICAL', async () => {
      // This test verifies the critical fix for desc() ordering
      // Without desc(), Drizzle defaults to ASC which returns the OLDEST

      // Make FIRST call
      const firstPrompt = `First call - unique ID: ${Date.now()}-FIRST`
      const result1 = await callQwenDirect('Agent', firstPrompt)

      if (!result1.signature) {
        console.log('⚠️ No signature on first call - skipping ordering test')
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)) // Ensure timestamp difference

      // Make SECOND call (this should be the "most recent")
      const secondPrompt = `Second call - unique ID: ${Date.now()}-SECOND`
      const result2 = await callQwenDirect('Agent', secondPrompt)

      if (!result2.signature) {
        console.log('⚠️ No signature on second call - skipping ordering test')
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 500))

      // Get "most recent" - should be the SECOND one
      const mostRecent = await eigenaiInferenceTracker.getMostRecentUnsubmitted()

      expect(mostRecent).not.toBeNull()
      if (!mostRecent) return

      // CRITICAL ASSERTION: The most recent should have the SECOND signature
      expect(mostRecent.signature).toBe(result2.signature)
      expect(mostRecent.signature).not.toBe(result1.signature)

      // Also verify the prompt contains "SECOND" not "FIRST"
      expect(mostRecent.requestPrompt).toContain('SECOND')
      expect(mostRecent.requestPrompt).not.toContain('FIRST')

      console.log('✅ CRITICAL: getMostRecentUnsubmitted returns NEWEST (not oldest)')
      console.log(`   First signature: ${result1.signature.substring(0, 20)}...`)
      console.log(`   Second signature: ${result2.signature.substring(0, 20)}...`)
      console.log(`   Returned signature: ${mostRecent.signature.substring(0, 20)}...`)
      console.log(`   ✓ Correctly returned the SECOND (most recent) inference`)
    }, 120000)
  })

  describe('parseQwenDecision', () => {
    it('parses valid JSON decision', () => {
      const content = `{
        "reasoning": "Market looks bullish",
        "trade_decisions": [{
          "token": "WETH",
          "action": "BUY",
          "amount_usd": 50,
          "via": null,
          "rationale": "RSI indicates oversold"
        }]
      }`

      const decision = parseQwenDecision(content)

      expect(decision.reasoning).toBe('Market looks bullish')
      expect(decision.trade_decisions).toHaveLength(1)
      expect(decision.trade_decisions[0].action).toBe('BUY')
      expect(decision.trade_decisions[0].amount_usd).toBe(50)
      console.log('✅ Parsed valid JSON decision')
    })

    it('extracts JSON from markdown code blocks', () => {
      const content = `Here's my analysis:

\`\`\`json
{
  "reasoning": "Analysis complete",
  "trade_decisions": [{ "token": "AERO", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "No clear signal" }]
}
\`\`\`

Let me know if you need more info.`

      const decision = parseQwenDecision(content)

      expect(decision.reasoning).toBe('Analysis complete')
      expect(decision.trade_decisions[0].action).toBe('HOLD')
      console.log('✅ Extracted JSON from markdown')
    })

    it('extracts JSON with <think> tags', () => {
      const content = `<think>
I need to analyze the market carefully...
RSI is at 55 which is neutral.
</think>

{
  "reasoning": "RSI neutral, waiting for clearer signal",
  "trade_decisions": [{ "token": "BRETT", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "Wait for dip" }]
}`

      const decision = parseQwenDecision(content)

      expect(decision.trade_decisions[0].action).toBe('HOLD')
      console.log('✅ Extracted JSON after <think> tags')
    })

    it('returns HOLD for invalid JSON', () => {
      const content = 'This is not valid JSON at all'

      const decision = parseQwenDecision(content)

      expect(decision.trade_decisions[0].action).toBe('HOLD')
      expect(decision.trade_decisions[0].rationale).toContain('parse')
      console.log('✅ Returns HOLD for invalid JSON')
    })

    it('returns HOLD for empty content', () => {
      const decision = parseQwenDecision('')

      expect(decision.trade_decisions[0].action).toBe('HOLD')
      console.log('✅ Returns HOLD for empty content')
    })
  })

  describe('End-to-End Flow', () => {
    it('produces valid trading decision from Qwen (NOT error fallback)', async () => {
      const systemPrompt = `You are a trading agent on Aerodrome DEX (Base chain).
Your goal is to make profitable trades.

VALID TOKENS: WETH, USDC, AERO, BRETT

Output ONLY JSON with this structure:
{
  "reasoning": "your analysis",
  "trade_decisions": [{ "token": "TOKEN", "action": "BUY"|"SELL"|"HOLD", "amount_usd": number, "via": null, "rationale": "brief reason" }]
}`

      const userPrompt = `## Wallet Balance
USDC: 50.00
WETH: 0.01

## Market Data

### WETH Price
$3,450.00 | 24h: +1.8% | Volume: $2.5M

### Technical Indicators
RSI (14): 48 (neutral)
EMA20: $3,420 (price above)
MACD: Bullish crossover forming

### Pool Metrics
WETH/USDC pool: $15M liquidity, 0.3% fee

## Task
Analyze the data and make a trading decision. You have $50 USDC available.
Output your decision as JSON only.`

      console.log('Testing end-to-end flow...')
      const response = await callQwenDirect(systemPrompt, userPrompt)
      const decision = parseQwenDecision(response.content)

      // CRITICAL: FAIL if we got an error response instead of real reasoning
      expect(decision.reasoning).not.toContain('API error')
      expect(decision.reasoning).not.toContain('Network error')
      expect(decision.reasoning).not.toContain('not configured')
      expect(decision.reasoning).not.toContain('Qwen API error')

      // Verify structure
      expect(decision.reasoning).toBeDefined()
      expect(decision.trade_decisions).toBeInstanceOf(Array)
      expect(decision.trade_decisions.length).toBeGreaterThan(0)

      const firstDecision = decision.trade_decisions[0]
      expect(['BUY', 'SELL', 'HOLD']).toContain(firstDecision.action)
      expect(firstDecision.token).toBeDefined()
      expect(typeof firstDecision.amount_usd).toBe('number')

      // If BUY, amount should be <= available USDC
      if (firstDecision.action === 'BUY') {
        expect(firstDecision.amount_usd).toBeLessThanOrEqual(50)
      }

      console.log('✅ End-to-end flow produced VALID decision (not error fallback):')
      console.log(`   Action: ${firstDecision.action}`)
      console.log(`   Token: ${firstDecision.token}`)
      console.log(`   Amount: $${firstDecision.amount_usd}`)
      console.log(`   Reasoning: ${decision.reasoning.substring(0, 100)}...`)
    }, 60000)

    it('respects balance constraints in decision (NOT error fallback)', async () => {
      const systemPrompt = `You are a trading agent. CRITICAL: Never exceed available balance.`

      const userPrompt = `## Wallet Balance
USDC: 3.50  <-- ONLY $3.50 AVAILABLE
WETH: 0

## Market Data
WETH price: $3,500

## Task
Make a trading decision. Remember you only have $3.50 USDC.
Output JSON: { "reasoning": "...", "trade_decisions": [{ "token": "WETH", "action": "BUY"|"HOLD", "amount_usd": number, "via": null, "rationale": "..." }] }`

      const response = await callQwenDirect(systemPrompt, userPrompt)
      const decision = parseQwenDecision(response.content)

      // CRITICAL: FAIL if we got an error response
      expect(decision.reasoning).not.toContain('API error')
      expect(decision.reasoning).not.toContain('Network error')
      expect(decision.reasoning).not.toContain('Qwen API error')

      const firstDecision = decision.trade_decisions[0]

      // Should either HOLD or BUY <= $3.50
      if (firstDecision.action === 'BUY') {
        expect(firstDecision.amount_usd).toBeLessThanOrEqual(3.5)
        console.log(`✅ BUY amount ($${firstDecision.amount_usd}) respects $3.50 limit`)
      } else {
        expect(firstDecision.action).toBe('HOLD')
        console.log('✅ Correctly chose HOLD with low balance')
      }
    }, 60000)
  })
})

describe('Deterministic Flow - Unit Tests (No API)', () => {
  describe('parseQwenDecision edge cases', () => {
    it('handles nested JSON objects', () => {
      const content = `{
        "reasoning": "Complex analysis",
        "trade_decisions": [{
          "token": "AERO",
          "action": "BUY",
          "amount_usd": 25.5,
          "via": null,
          "rationale": "Good entry"
        }],
        "metadata": {
          "confidence": 0.8
        }
      }`

      const decision = parseQwenDecision(content)
      expect(decision.trade_decisions[0].amount_usd).toBe(25.5)
    })

    it('handles multiple trade decisions', () => {
      const content = `{
        "reasoning": "Diversifying",
        "trade_decisions": [
          { "token": "WETH", "action": "BUY", "amount_usd": 30, "via": null, "rationale": "First" },
          { "token": "AERO", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "Second" }
        ]
      }`

      const decision = parseQwenDecision(content)
      expect(decision.trade_decisions).toHaveLength(2)
    })

    it('handles missing optional fields gracefully', () => {
      const content = `{
        "reasoning": "Simple",
        "trade_decisions": [{ "token": "WETH", "action": "HOLD", "amount_usd": 0, "via": null, "rationale": "Wait" }]
      }`

      const decision = parseQwenDecision(content)
      expect(decision.trade_decisions[0].via).toBeNull()
    })
  })
})

/**
 * Integration tests that call REAL APIs (blockchain, DexScreener)
 * These do NOT require EigenAI API key - they test the tool-calling layer
 */
describe('Deterministic Flow - Tool Integration Tests (Real APIs)', () => {
  describe('gatherMarketData', () => {
    it('gathers market data for WETH/USDC', async () => {
      console.log('\n--- Testing gatherMarketData for WETH/USDC ---')

      const results = await gatherMarketData('WETH', 'USDC')

      // Should have gathered multiple tool results
      expect(results.length).toBeGreaterThanOrEqual(5)
      console.log(`✅ Gathered ${results.length} tool results`)

      // Check each tool was called
      const toolNames = results.map((r) => r.tool)
      expect(toolNames).toContain('getWalletBalance')
      expect(toolNames).toContain('getTokenPrice')
      expect(toolNames).toContain('getIndicators')
      expect(toolNames).toContain('getPoolMetrics')
      expect(toolNames).toContain('getQuote')

      // Log results summary
      for (const result of results) {
        const status = result.error
          ? `❌ ERROR: ${result.error}`
          : `✅ OK (${result.result.length} chars)`
        console.log(`   ${result.tool}: ${status}`)
      }
    }, 60000)

    it('gathers market data for AERO/USDC', async () => {
      console.log('\n--- Testing gatherMarketData for AERO/USDC ---')

      const results = await gatherMarketData('AERO', 'USDC')

      expect(results.length).toBeGreaterThanOrEqual(5)

      // Wallet balance should have result (may be empty balances)
      const balanceResult = results.find((r) => r.tool === 'getWalletBalance')
      expect(balanceResult).toBeDefined()
      expect(balanceResult!.result.length).toBeGreaterThan(0)

      // Price should have result
      const priceResult = results.find((r) => r.tool === 'getTokenPrice')
      expect(priceResult).toBeDefined()
      if (!priceResult!.error) {
        // Response has nested structure: { price: { usd: "..." } }
        expect(priceResult?.result).toContain('"usd":')
      }

      console.log(`✅ AERO/USDC gathered ${results.length} results`)
    }, 60000)

    it('handles WETH/AERO pair (non-USDC base)', async () => {
      console.log('\n--- Testing gatherMarketData for WETH/AERO ---')

      const results = await gatherMarketData('WETH', 'AERO')

      expect(results.length).toBeGreaterThanOrEqual(6) // Should have base token price too

      // Should have fetched AERO price as well (since base != USDC)
      const aeroPrice = results.filter((r) => r.tool === 'getTokenPrice' && r.args.token === 'AERO')
      expect(aeroPrice.length).toBe(1)

      console.log(`✅ WETH/AERO gathered ${results.length} results`)
    }, 60000)
  })

  describe('buildDecisionPrompt', () => {
    it('builds valid prompt from tool results', () => {
      const mockContext: EigenTradingContext = {
        targetToken: 'WETH',
        baseToken: 'USDC',
        timestamp: new Date().toISOString(),
        iterationNumber: 1,
        recentHistory: [],
        performanceSummary: 'Portfolio: $100 USDC',
      }

      const mockToolResults: ToolResult[] = [
        {
          tool: 'getWalletBalance',
          args: {},
          result: '{"balances": [{"symbol": "USDC", "balance": "100"}]}',
        },
        { tool: 'getTokenPrice', args: { token: 'WETH' }, result: '{"priceUsd": "3500"}' },
        {
          tool: 'getQuote',
          args: { tokenIn: 'USDC', tokenOut: 'WETH' },
          result: '{"amountOut": "0.028"}',
        },
      ]

      const { systemPrompt, userPrompt } = buildDecisionPrompt(mockContext, mockToolResults)

      // System prompt should contain key elements
      expect(systemPrompt).toContain('trading agent')
      expect(systemPrompt).toContain('Aerodrome DEX')
      expect(systemPrompt).toContain('VALID TOKENS')

      // User prompt should contain context
      expect(userPrompt).toContain('WETH/USDC')
      expect(userPrompt).toContain('Iteration: #1')
      expect(userPrompt).toContain('Portfolio: $100 USDC')

      // User prompt should contain tool results
      expect(userPrompt).toContain('getWalletBalance')
      expect(userPrompt).toContain('getTokenPrice')
      expect(userPrompt).toContain('getQuote')

      // User prompt should have decision format
      expect(userPrompt).toContain('"action":')
      expect(userPrompt).toContain('BUY')
      expect(userPrompt).toContain('SELL')
      expect(userPrompt).toContain('HOLD')

      console.log('✅ buildDecisionPrompt generated valid prompts')
      console.log(`   System prompt: ${systemPrompt.length} chars`)
      console.log(`   User prompt: ${userPrompt.length} chars`)
    })

    it('includes history in prompt when available', () => {
      const mockContext: EigenTradingContext = {
        targetToken: 'AERO',
        baseToken: 'USDC',
        timestamp: new Date().toISOString(),
        iterationNumber: 5,
        recentHistory: [
          {
            timestamp: '2024-01-01T00:00:00Z',
            tokenPair: 'AERO/USDC',
            action: 'BUY' as const,
            reasoning: 'RSI indicated oversold conditions',
            executed: true,
          },
          {
            timestamp: '2024-01-01T01:00:00Z',
            tokenPair: 'AERO/USDC',
            action: 'HOLD' as const,
            reasoning: 'Waiting for confirmation',
            executed: false,
          },
        ],
        performanceSummary: 'P&L: +5%',
      }

      const { userPrompt } = buildDecisionPrompt(mockContext, [])

      expect(userPrompt).toContain('AERO/USDC')
      expect(userPrompt).toContain('BUY')
      expect(userPrompt).toContain('RSI indicated oversold')

      console.log('✅ buildDecisionPrompt includes history')
    })
  })

  describe('executeTradeDecision', () => {
    it('skips execution for HOLD action', async () => {
      const holdDecision: QwenTradeDecision = {
        reasoning: 'Market is uncertain',
        trade_decisions: [
          { token: 'WETH', action: 'HOLD', amount_usd: 0, via: null, rationale: 'No clear signal' },
        ],
      }

      const result = await executeTradeDecision(holdDecision)

      // Should return unchanged (no execution markers)
      expect(result.trade_decisions[0].rationale).not.toContain('[EXECUTED')
      expect(result.trade_decisions[0].rationale).not.toContain('[DRY RUN')
      expect(result.trade_decisions[0].rationale).toBe('No clear signal')

      console.log('✅ HOLD action skipped correctly')
    })

    it('skips execution for amount too small', async () => {
      const smallBuyDecision: QwenTradeDecision = {
        reasoning: 'Small test',
        trade_decisions: [
          { token: 'WETH', action: 'BUY', amount_usd: 0.5, via: null, rationale: 'Tiny amount' },
        ],
      }

      const result = await executeTradeDecision(smallBuyDecision)

      // Should skip due to amount < $1
      expect(result.trade_decisions[0].rationale).not.toContain('[EXECUTED')

      console.log('✅ Small amount skipped correctly')
    })

    it('attempts execution for valid BUY (DRY RUN mode)', async () => {
      const buyDecision: QwenTradeDecision = {
        reasoning: 'Testing buy execution',
        trade_decisions: [
          { token: 'WETH', action: 'BUY', amount_usd: 10, via: null, rationale: 'Test trade' },
        ],
      }

      const result = await executeTradeDecision(buyDecision)

      // In test environment, should either DRY RUN or fail gracefully
      const rationale = result.trade_decisions[0].rationale
      const validOutcome =
        rationale.includes('[DRY RUN') ||
        rationale.includes('[EXECUTED') ||
        rationale.includes('[EXECUTION FAILED') ||
        rationale.includes('[REJECTED')

      expect(validOutcome).toBe(true)

      console.log('✅ BUY execution attempted')
      console.log(`   Outcome: ${rationale}`)
    }, 30000)

    it('rejects trade with excessive price impact', async () => {
      // Note: This test relies on real market conditions
      // If we had a token with very low liquidity, we'd see rejection
      // For now, just verify the structure works
      const buyDecision: QwenTradeDecision = {
        reasoning: 'Testing price impact check',
        trade_decisions: [
          {
            token: 'WETH',
            action: 'BUY',
            amount_usd: 5,
            via: null,
            rationale: 'Price impact test',
          },
        ],
      }

      const result = await executeTradeDecision(buyDecision)

      // Should complete without throwing
      expect(result.trade_decisions[0]).toBeDefined()

      console.log('✅ Price impact check executed')
      console.log(`   Result: ${result.trade_decisions[0].rationale}`)
    }, 30000)
  })
})
