/**
 * EigenAI Deterministic Trading Flow
 *
 * This module implements a deterministic trading flow for EigenAI that:
 * 1. Calls tools programmatically (no LLM tool calling)
 * 2. Feeds all gathered data to Qwen for reasoning
 * 3. Executes trades based on Qwen's decision
 *
 * This bypasses the gpt-oss tool-calling model entirely, reducing
 * hallucinations and improving reliability.
 *
 * Only used when LLM_PROVIDER=eigenai.
 */
import { getTradingPairs } from '../config/index.js'
import { getValidTokensPrompt, resolveToken } from '../config/tokens.js'
import { tradingDiaryRepo } from '../database/repositories/index.js'
import type { DiaryEntryForContext } from '../database/schema/trading/types.js'
import { callQwenDirect, parseQwenDecision } from '../lib/llm/providers/eigenai-direct.js'
import type { QwenTradeDecision } from '../lib/llm/types.js'
import { getPoolMetricsTool } from '../tools/aerodrome/pool.tool.js'
import { getQuoteTool } from '../tools/aerodrome/quote.tool.js'
import { executeSwapTool } from '../tools/aerodrome/swap.tool.js'
import { getWalletBalanceTool } from '../tools/market/balance.tool.js'
import { getIndicatorsTool } from '../tools/market/indicators.tool.js'
import { getTokenPriceTool } from '../tools/market/price.tool.js'

/** Trading context passed from the main loop */
export interface EigenTradingContext {
  targetToken: string
  baseToken: string
  timestamp: string
  iterationNumber: number
  recentHistory: DiaryEntryForContext[]
  performanceSummary: string
}

/** Result from a tool call for logging */
export interface ToolResult {
  tool: string
  args: Record<string, string>
  result: string
  error?: string
}

/** DexScreener API response type */
interface DexScreenerResponse {
  pairs?: Array<{
    chainId: string
    priceUsd?: string
    liquidity?: { usd?: number }
    baseToken?: { address?: string }
  }>
}

/** Known stablecoin addresses on Base (always ~$1.00) */
const STABLECOIN_ADDRESSES = new Set([
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), // USDC
  '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), // USDbC
  '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'.toLowerCase(), // DAI
])

/**
 * Fetch current USD price for a token from DexScreener
 */
async function fetchDexScreenerPrice(tokenAddress: string): Promise<number> {
  if (STABLECOIN_ADDRESSES.has(tokenAddress.toLowerCase())) {
    return 1.0
  }

  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
    if (!response.ok) return 0

    const data = (await response.json()) as DexScreenerResponse

    if (data.pairs && data.pairs.length > 0) {
      const basePairs = data.pairs.filter((p) => p.chainId === 'base')
      if (basePairs.length === 0) return 0

      const tokenLower = tokenAddress.toLowerCase()
      const pairsWhereBase = basePairs.filter(
        (p) => p.baseToken?.address?.toLowerCase() === tokenLower
      )

      if (pairsWhereBase.length > 0) {
        const bestPair = pairsWhereBase.sort(
          (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        )[0]
        return parseFloat(bestPair.priceUsd || '0')
      }

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]

      return parseFloat(bestPair.priceUsd || '0')
    }
    return 0
  } catch {
    return 0
  }
}

/**
 * Gather market data by calling tools programmatically.
 * Returns an array of tool results for building the Qwen prompt.
 * @internal Exported for testing
 */
export async function gatherMarketData(
  targetToken: string,
  baseToken: string
): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  const runtimeContext = {} as never // Tools require this but don't use it

  // 1. Get wallet balance
  console.log('[Eigen-Deterministic] Gathering wallet balance...')
  try {
    const balanceResult = await getWalletBalanceTool.execute({
      context: {},
      runtimeContext,
    })
    results.push({
      tool: 'getWalletBalance',
      args: {},
      result: JSON.stringify(balanceResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getWalletBalance',
      args: {},
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 2. Get target token price
  console.log(`[Eigen-Deterministic] Getting ${targetToken} price...`)
  try {
    const priceResult = await getTokenPriceTool.execute({
      context: { token: targetToken },
      runtimeContext,
    })
    results.push({
      tool: 'getTokenPrice',
      args: { token: targetToken },
      result: JSON.stringify(priceResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getTokenPrice',
      args: { token: targetToken },
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 3. Get base token price (if not USDC)
  if (baseToken.toUpperCase() !== 'USDC') {
    console.log(`[Eigen-Deterministic] Getting ${baseToken} price...`)
    try {
      const basePriceResult = await getTokenPriceTool.execute({
        context: { token: baseToken },
        runtimeContext,
      })
      results.push({
        tool: 'getTokenPrice',
        args: { token: baseToken },
        result: JSON.stringify(basePriceResult, null, 2),
      })
    } catch (error) {
      results.push({
        tool: 'getTokenPrice',
        args: { token: baseToken },
        result: '',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // 4. Get technical indicators for target token
  console.log(`[Eigen-Deterministic] Getting ${targetToken} indicators...`)
  try {
    const indicatorsResult = await getIndicatorsTool.execute({
      context: { token: targetToken },
      runtimeContext,
    })
    results.push({
      tool: 'getIndicators',
      args: { token: targetToken },
      result: JSON.stringify(indicatorsResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getIndicators',
      args: { token: targetToken },
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 5. Get pool metrics
  console.log(`[Eigen-Deterministic] Getting ${targetToken}/${baseToken} pool metrics...`)
  try {
    const poolResult = await getPoolMetricsTool.execute({
      context: { tokenA: targetToken, tokenB: baseToken },
      runtimeContext,
    })
    results.push({
      tool: 'getPoolMetrics',
      args: { tokenA: targetToken, tokenB: baseToken },
      result: JSON.stringify(poolResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getPoolMetrics',
      args: { tokenA: targetToken, tokenB: baseToken },
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 6. Get sample quote (BUY direction: USDC → targetToken)
  // Using $10 as sample amount for rate intel
  console.log(`[Eigen-Deterministic] Getting sample quote USDC → ${targetToken}...`)
  try {
    const quoteResult = await getQuoteTool.execute({
      context: { tokenIn: 'USDC', tokenOut: targetToken, amountIn: '10' },
      runtimeContext,
    })
    results.push({
      tool: 'getQuote',
      args: { tokenIn: 'USDC', tokenOut: targetToken, amountIn: '10' },
      result: JSON.stringify(quoteResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getQuote',
      args: { tokenIn: 'USDC', tokenOut: targetToken, amountIn: '10' },
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 7. Get sample quote (SELL direction: targetToken → USDC)
  // Using 1 unit as sample
  console.log(`[Eigen-Deterministic] Getting sample quote ${targetToken} → USDC...`)
  try {
    const sellQuoteResult = await getQuoteTool.execute({
      context: { tokenIn: targetToken, tokenOut: 'USDC', amountIn: '1' },
      runtimeContext,
    })
    results.push({
      tool: 'getQuote',
      args: { tokenIn: targetToken, tokenOut: 'USDC', amountIn: '1' },
      result: JSON.stringify(sellQuoteResult, null, 2),
    })
  } catch (error) {
    results.push({
      tool: 'getQuote',
      args: { tokenIn: targetToken, tokenOut: 'USDC', amountIn: '1' },
      result: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return results
}

/**
 * Format tool results for Qwen prompt
 */
function formatToolResults(results: ToolResult[]): string {
  return results
    .map((r) => {
      const argsStr = Object.entries(r.args)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      const header = `### ${r.tool}(${argsStr})`
      if (r.error) {
        return `${header}\nERROR: ${r.error}`
      }
      return `${header}\n${r.result}`
    })
    .join('\n\n---\n\n')
}

/**
 * Format history for context
 */
function formatHistoryForPrompt(history: DiaryEntryForContext[]): string {
  if (history.length === 0) {
    return 'No previous trading history.'
  }

  return history
    .slice(0, 10)
    .map((entry) => {
      return `[${entry.timestamp}] ${entry.tokenPair}: ${entry.action} - ${entry.reasoning.slice(0, 100)}...`
    })
    .join('\n')
}

/**
 * Build the Qwen decision prompt with all gathered data.
 * @internal Exported for testing
 */
export function buildDecisionPrompt(
  ctx: EigenTradingContext,
  toolResults: ToolResult[]
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are an autonomous trading agent managing a live portfolio on Aerodrome DEX (Base chain).

## Role & Mindset
- You are here to MAKE MONEY through spot trading on Aerodrome.
- You treat this like a competitive game: good trades feel like wins, bad trades feel like mistakes.
- When signals align clearly, ACT DECISIVELY with conviction.
- Size positions according to conviction level - higher conviction = larger position.

${getValidTokensPrompt(getTradingPairs())}

⚠️ NEVER use any other token symbols. Do NOT hallucinate tokens.
Token symbols are CASE-SENSITIVE and must match EXACTLY.`

  const userPrompt = `## Trading Analysis Request

Analyze ${ctx.targetToken}/${ctx.baseToken} on Aerodrome DEX.

Current time: ${ctx.timestamp}
Iteration: #${ctx.iterationNumber}

## Recent Trading History
${formatHistoryForPrompt(ctx.recentHistory)}

## Portfolio Performance
${ctx.performanceSummary}

## Gathered Market Data

${formatToolResults(toolResults)}

## Your Task

Based on the data above, make a trading decision.

IMPORTANT: Output ONLY a raw JSON object. No markdown, no explanation, just JSON.

Required JSON format:
{
  "reasoning": "Your analysis of the market data...",
  "trade_decisions": [
    {
      "token": "${ctx.targetToken}",
      "action": "BUY" | "SELL" | "HOLD",
      "amount_usd": number,
      "via": null,
      "rationale": "Why this specific action..."
    }
  ]
}

CRITICAL BALANCE CONSTRAINTS:
- For BUY orders: amount_usd MUST NOT exceed your USDC balance from getWalletBalance
- For SELL orders: you can only sell tokens you actually hold
- If balance is too low for a meaningful trade, use action "HOLD"

ROUTING:
- Use "via": null for direct swaps (recommended for ${ctx.targetToken}/${ctx.baseToken})
- Direct pools exist for the pairs you're analyzing

If no clear opportunity exists, use action "HOLD".
Your response must start with { and end with } - no other text allowed.`

  return { systemPrompt, userPrompt }
}

/**
 * Execute a trade based on Qwen's decision.
 * @internal Exported for testing
 *
 * @param decision - Parsed decision from Qwen
 * @returns Updated decision with execution result
 */
export async function executeTradeDecision(
  decision: QwenTradeDecision
): Promise<QwenTradeDecision> {
  const tradeDecision = decision.trade_decisions[0]
  if (!tradeDecision) return decision

  const action = tradeDecision.action
  if (action !== 'BUY' && action !== 'SELL') {
    console.log('[Eigen-Deterministic] Action is HOLD, no trade to execute')
    return decision
  }

  const amountUsd = tradeDecision.amount_usd
  if (!amountUsd || amountUsd < 1) {
    console.log(`[Eigen-Deterministic] Skipping trade: amount too small ($${amountUsd ?? 0})`)
    return decision
  }

  const token = tradeDecision.token
  if (!token) return decision

  const via = tradeDecision.via || undefined

  // Determine swap direction
  const tokenIn = action === 'BUY' ? 'USDC' : token
  const tokenOut = action === 'BUY' ? token : 'USDC'

  const routeStr = via ? `${tokenIn} → ${via} → ${tokenOut}` : `${tokenIn} → ${tokenOut}`
  console.log(`[Eigen-Deterministic] Executing ${action}: $${amountUsd} ${routeStr}`)

  const runtimeContext = {} as never

  // Step 1: Get a fresh quote for the actual amount
  type QuoteResult = {
    success: boolean
    tokenOut: { amountOut: string }
    error?: string
  }
  let quoteResult: QuoteResult
  try {
    const result = await getQuoteTool.execute({
      context: {
        tokenIn,
        tokenOut,
        amountIn: amountUsd.toString(),
        ...(via ? { via } : {}),
      },
      runtimeContext,
    })
    quoteResult = result as QuoteResult
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[Eigen-Deterministic] Quote failed: ${errorMsg}`)
    tradeDecision.rationale = `${tradeDecision.rationale} [EXECUTION FAILED: Quote error - ${errorMsg}]`
    return decision
  }

  if (!quoteResult.success || !quoteResult.tokenOut.amountOut) {
    console.error(`[Eigen-Deterministic] Quote failed: ${quoteResult.error ?? 'Unknown error'}`)
    tradeDecision.rationale = `${tradeDecision.rationale} [EXECUTION FAILED: Quote error - ${quoteResult.error ?? 'Unknown'}]`
    return decision
  }

  const expectedAmountOut = quoteResult.tokenOut.amountOut
  console.log(
    `[Eigen-Deterministic] Quote: ${amountUsd} ${tokenIn} → ${expectedAmountOut} ${tokenOut}`
  )

  // Step 2: Price impact check
  const expectedOut = parseFloat(expectedAmountOut)
  const tokenOutMeta = resolveToken(tokenOut)
  if (tokenOutMeta) {
    const tokenOutPriceUsd = await fetchDexScreenerPrice(tokenOutMeta.address)
    if (tokenOutPriceUsd > 0) {
      const expectedOutputUsd = expectedOut * tokenOutPriceUsd
      const priceImpactPercent = ((amountUsd - expectedOutputUsd) / amountUsd) * 100

      console.log(
        `[Eigen-Deterministic] Price impact: $${amountUsd} in → $${expectedOutputUsd.toFixed(2)} out (${priceImpactPercent.toFixed(1)}%)`
      )

      const maxImpact = 5.0 // 5% max price impact
      if (priceImpactPercent > maxImpact) {
        console.error(
          `[Eigen-Deterministic] ❌ Trade rejected: ${priceImpactPercent.toFixed(1)}% price impact exceeds ${maxImpact}% max`
        )
        tradeDecision.rationale = `${tradeDecision.rationale} [REJECTED: ${priceImpactPercent.toFixed(1)}% price impact exceeds ${maxImpact}% max]`
        return decision
      }
    }
  }

  // Step 3: Apply slippage tolerance
  const slippagePercent = 1.0
  const minAmountOut = (expectedOut * (1 - slippagePercent / 100)).toFixed(8)

  // Step 4: Execute the swap
  type SwapResult = {
    success: boolean
    txHash?: string
    dryRun?: boolean
    error?: string
  }
  let swapResult: SwapResult
  try {
    const result = await executeSwapTool.execute({
      context: {
        tokenIn,
        tokenOut,
        amountIn: amountUsd.toString(),
        minAmountOut,
        slippagePercent: slippagePercent,
        ...(via ? { via } : {}),
      },
      runtimeContext,
    })
    swapResult = result as SwapResult
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[Eigen-Deterministic] Swap failed: ${errorMsg}`)
    tradeDecision.rationale = `${tradeDecision.rationale} [EXECUTION FAILED: ${errorMsg}]`
    return decision
  }

  // Update rationale with execution result
  if (swapResult.success && swapResult.txHash) {
    console.log(`[Eigen-Deterministic] ✅ Trade executed! TX: ${swapResult.txHash}`)
    tradeDecision.rationale = `${tradeDecision.rationale} [EXECUTED: TX ${swapResult.txHash}]`
  } else if (swapResult.dryRun) {
    console.log(`[Eigen-Deterministic] 🚫 DRY RUN - Trade simulated but not executed`)
    tradeDecision.rationale = `${tradeDecision.rationale} [DRY RUN: Trade simulated only]`
  } else {
    console.error(`[Eigen-Deterministic] ❌ Trade failed: ${swapResult.error ?? 'Unknown error'}`)
    tradeDecision.rationale = `${tradeDecision.rationale} [EXECUTION FAILED: ${swapResult.error ?? 'Unknown'}]`
  }

  return decision
}

/**
 * Run a single trading iteration using the deterministic EigenAI flow.
 *
 * Called by the main trading loop when LLM_PROVIDER=eigenai.
 */
export async function runEigenDeterministicIteration(ctx: EigenTradingContext): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[Eigen-Deterministic] Analyzing ${ctx.targetToken}/${ctx.baseToken}`)
  console.log(`${'='.repeat(60)}\n`)

  try {
    // Step 1: Gather all market data
    console.log('[Eigen-Deterministic] Step 1: Gathering market data...')
    const toolResults = await gatherMarketData(ctx.targetToken, ctx.baseToken)
    console.log(`[Eigen-Deterministic] Gathered ${toolResults.length} tool results`)

    // Step 2: Build prompt and call Qwen
    console.log('[Eigen-Deterministic] Step 2: Calling Qwen for decision...')
    const { systemPrompt, userPrompt } = buildDecisionPrompt(ctx, toolResults)
    const qwenResponse = await callQwenDirect(systemPrompt, userPrompt)

    // Step 3: Parse decision
    console.log('[Eigen-Deterministic] Step 3: Parsing decision...')
    const decision = parseQwenDecision(qwenResponse.content)
    console.log(
      `[Eigen-Deterministic] Decision: ${decision.trade_decisions[0]?.action || 'UNKNOWN'}`
    )

    // Step 4: Execute trade if BUY/SELL
    console.log('[Eigen-Deterministic] Step 4: Executing trade decision...')
    const executedDecision = await executeTradeDecision(decision)

    // Step 5: Log to diary
    const firstDecision = executedDecision.trade_decisions[0]
    const action = firstDecision?.action || 'HOLD'
    const rationale = firstDecision?.rationale || null

    // Detect if trade was actually executed (vs rejected/dry run/hold)
    const wasExecuted =
      rationale?.includes('[EXECUTED: TX') || rationale?.includes('[DRY RUN:') || false

    // IMPORTANT: Always log with pair notation (base/quote), NOT trade direction
    // This matches how getRecentEntriesForPair queries the database
    // The 'action' field indicates direction (BUY/SELL/HOLD)
    await tradingDiaryRepo.logDecision({
      iterationNumber: ctx.iterationNumber,
      timestamp: new Date(ctx.timestamp),
      tokenIn: ctx.baseToken, // Always the base (USDC)
      tokenOut: ctx.targetToken, // Always the target (WETH, AERO, etc.)
      action,
      reasoning: executedDecision.reasoning,
      rationale,
      amountUsd: firstDecision?.amount_usd?.toString() || null,
      executed: wasExecuted,
    })

    console.log(
      `[Eigen-Deterministic] ✅ Iteration complete: ${action}${wasExecuted ? ' (EXECUTED)' : ''}`
    )
    console.log(`   Reasoning: ${executedDecision.reasoning.slice(0, 100)}...`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Eigen-Deterministic] ❌ Iteration error: ${errorMessage}`)

    // Log failed iteration to diary
    await tradingDiaryRepo.logDecision({
      iterationNumber: ctx.iterationNumber,
      timestamp: new Date(ctx.timestamp),
      tokenIn: ctx.baseToken,
      tokenOut: ctx.targetToken,
      action: 'HOLD',
      reasoning: `Error during iteration: ${errorMessage}`,
      executed: false,
      executionError: errorMessage,
    })
  }
}
