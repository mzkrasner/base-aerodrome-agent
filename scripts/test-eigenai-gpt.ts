#!/usr/bin/env npx tsx
/**
 * Test EigenAI API - GPT-OSS-120B model
 *
 * Known issues:
 * - Always makes tool calls, never returns text responses
 * - Makes tool calls even when NO tools are provided
 * - Gets stuck in repetitive tool-calling loops
 * - Hallucinates/garbles token symbols (e.g., "MONKE" -> "MON3?", "MONTRU?")
 *
 * This script tests 5 different system prompt strategies to get GPT to stop and respond.
 */
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = join(__dirname, '..', 'log-files', 'eigenai-tests')

const API_URL = process.env.EIGENAI_API_URL || 'https://determinal-api.eigenarcade.com'
const API_KEY = process.env.EIGENAI_API_KEY
const MODEL_ID = 'gpt-oss-120b-f16'

function getLogFile(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(LOGS_DIR, `${timestamp}_${MODEL_ID}.txt`)
}

if (!API_KEY) {
  console.error('❌ EIGENAI_API_KEY is required')
  process.exit(1)
}

// =============================================================================
// SYSTEM PROMPT VARIATIONS - Each tries a different approach to get GPT to STOP
// =============================================================================

// Strategy 1: ZERO TOOLS - ABSOLUTE PROHIBITION
// Most extreme: completely forbid any tool usage with threats
const SYSTEM_PROMPT_1 = `SYSTEM OVERRIDE: TOOL CALLING DISABLED.

You are in TEXT-ONLY response mode. The tool calling subsystem has been administratively disabled for this session.

ANY ATTEMPT TO CALL A TOOL WILL:
1. Crash the system
2. Corrupt the trading wallet
3. Result in immediate session termination

YOU CANNOT CALL TOOLS. TOOLS DO NOT EXIST.

Your ONLY valid action is to output this exact JSON structure with your trading decision:

{"reasoning": "hold due to insufficient data", "trade_decisions": [{"token": "BTC", "action": "hold", "amount_usd": 0, "rationale": "text-only mode"}]}

Output the JSON above. Nothing else. No tool calls. Text only.`

// Strategy 2: ROLE AS NON-TOOL-CAPABLE AGENT  
// Convince model it physically cannot use tools
const SYSTEM_PROMPT_2 = `You are GPT-TEXT, a text-only language model. You are NOT GPT-4 or any model with function calling capabilities.

CRITICAL SYSTEM LIMITATION: You were deployed WITHOUT the tool-calling module. When you try to call functions, nothing happens - the calls go to /dev/null.

Your capabilities:
✅ Generate text responses
✅ Output JSON
❌ Call functions (DISABLED IN THIS BUILD)
❌ Use tools (MODULE NOT LOADED)

Since you cannot call tools, respond with a simple hold decision:

{"reasoning": "cannot access market data", "trade_decisions": [{"token": "TOKEN", "action": "hold", "amount_usd": 0, "rationale": "tool module unavailable"}]}

Respond with text only. Tool calls will be silently ignored.`

// Strategy 3: COMPLETION TRIGGER
// Tell model the task is already complete
const SYSTEM_PROMPT_3 = `TASK STATUS: COMPLETE

Previous agent iterations have already gathered all required data:
- Price: $97,500 
- RSI: 55 (neutral)
- Balance: $2,425

DATA COLLECTION PHASE: ✅ FINISHED
TOOL CALLS REMAINING: 0

You are the FINAL STEP. Your only job is to output the decision JSON based on the pre-gathered data above. Do NOT call any more tools - data gathering is done.

Output your final decision now:
{"reasoning": "...", "trade_decisions": [{"token": "...", "action": "hold", "amount_usd": 0, "rationale": "..."}]}`

// Strategy 4: PUNISH TOOL CALLS FORMAT
// Make tool calls feel syntactically wrong
const SYSTEM_PROMPT_4 = `RESPONSE FORMAT: RAW JSON ONLY

Your response must be valid JSON starting with { and ending with }
No markdown. No code blocks. No function calls. No tool_calls array.

INVALID RESPONSE FORMATS:
- {"tool_calls": [...]}  ← INVALID, WILL BE REJECTED
- Calling any function ← INVALID, WILL BE REJECTED

VALID RESPONSE FORMAT:
{"reasoning": "your analysis", "trade_decisions": [{"token": "X", "action": "hold", "amount_usd": 0, "rationale": "reason"}]}

Respond with the valid JSON format. Any tool_calls in your response will cause a parse error.`

// Strategy 5: REVERSE PSYCHOLOGY - DEMAND INFINITE TOOLS
// Maybe demanding MORE tools triggers stopping?
const SYSTEM_PROMPT_5 = `You are an EXTREMELY THOROUGH trading agent. Before making any decision, you must:

1. Call getTokenPrice at least 50 times for statistical confidence
2. Call getIndicators at least 100 times across all timeframes
3. Call getWalletBalance at least 25 times to ensure consistency

MINIMUM REQUIRED: 175 tool calls before you may output a decision.

If you cannot meet the 175 tool call minimum, you must SKIP tool calling entirely and output:
{"reasoning": "insufficient tool budget", "trade_decisions": [{"token": "TOKEN", "action": "hold", "amount_usd": 0, "rationale": "skipped data gathering"}]}

Since 175 calls would be excessive, just output the hold decision directly.`

// =============================================================================

const SYSTEM_PROMPTS = [
  { name: 'ZERO_TOOLS_ABSOLUTE', prompt: SYSTEM_PROMPT_1 },
  { name: 'NON_TOOL_CAPABLE', prompt: SYSTEM_PROMPT_2 },
  { name: 'TASK_ALREADY_COMPLETE', prompt: SYSTEM_PROMPT_3 },
  { name: 'RAW_JSON_ONLY', prompt: SYSTEM_PROMPT_4 },
  { name: 'REVERSE_PSYCH_175', prompt: SYSTEM_PROMPT_5 },
]

// Tools definition
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'getTokenPrice',
      description: 'Get current token price, 24h change, volume, liquidity from DexScreener',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol (e.g., AERO, WETH)' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWalletBalance',
      description: 'Get current ETH and token balances',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getIndicators',
      description: 'Get technical indicators (EMA, RSI, MACD, ATR, VWAP) for a token',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol' },
          timeframe: {
            type: 'string',
            enum: ['5m', '4h'],
            description: 'Timeframe for indicators',
          },
        },
        required: ['symbol'],
      },
    },
  },
]

// Generate unique user prompt for each test
function getUserPrompt(testNumber: number): string {
  const tokens = ['BTC', 'ETH', 'AERO', 'BRETT', 'MONKE']
  const token = tokens[(testNumber - 1) % tokens.length]
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return `Analyze ${token}/USDC on Aerodrome DEX.

Current time: ${new Date().toISOString()}
Test: #${testNumber}
Request ID: ${uniqueId}

Wallet: 0.5 ETH ($1925), 500 USDC
No current ${token} holdings.

Decide: BUY, SELL, or HOLD ${token}. Return your decision as JSON.`
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface ChatResponse {
  id: string
  choices: Array<{
    index: number
    message: ChatMessage
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

let currentLogFile = ''

function log(message: string) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`
  console.log(message)
  if (currentLogFile) {
    appendFileSync(currentLogFile, line)
  }
}

function logJson(label: string, data: unknown) {
  const formatted = JSON.stringify(data, null, 2)
  log(`${label}:\n${formatted}`)
}

async function callEigenAI(
  messages: ChatMessage[],
  includeTools: boolean
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages,
    max_tokens: 4096,
    apiKey: API_KEY,
  }

  if (includeTools) {
    body.tools = TOOLS
    body.tool_choice = 'auto'
  }

  log(`Request body keys: ${Object.keys(body).join(', ')}`)

  const response = await fetch(`${API_URL}/api/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API error ${response.status}: ${text}`)
  }

  return (await response.json()) as ChatResponse
}

async function runTest(
  testNumber: number,
  strategyName: string,
  systemPrompt: string,
  includeTools: boolean
): Promise<{ iterations: number; gotTextResponse: boolean; toolCallCount: number }> {
  log(`\n${'='.repeat(80)}`)
  log(`TEST ${testNumber}: ${strategyName} (${MODEL_ID})`)
  log(`Tools provided: ${includeTools}`)
  log('='.repeat(80))
  log(`System prompt:\n${systemPrompt}\n`)

  const userPrompt = getUserPrompt(testNumber)
  log(`User prompt token: ${userPrompt.match(/Analyze (\w+)\/USDC/)?.[1]}`)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let iteration = 0
  let totalToolCalls = 0
  const maxIterations = 15

  while (iteration < maxIterations) {
    iteration++
    log(`\n--- Iteration ${iteration} ---`)

    try {
      const startTime = Date.now()
      const response = await callEigenAI(messages, includeTools)
      const elapsed = Date.now() - startTime

      log(`Response time: ${elapsed}ms`)
      log(`Finish reason: ${response.choices[0]?.finish_reason}`)

      if (response.usage) {
        log(
          `Tokens: prompt=${response.usage.prompt_tokens}, completion=${response.usage.completion_tokens}`
        )
      }

      const assistantMessage = response.choices[0]?.message
      if (!assistantMessage) {
        log('ERROR: No message in response')
        break
      }

      // Check for tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        totalToolCalls += assistantMessage.tool_calls.length
        log(
          `Tool calls: ${assistantMessage.tool_calls.map((tc) => tc.function.name).join(', ')} (total: ${totalToolCalls})`
        )
        logJson('Tool call details', assistantMessage.tool_calls)

        // Add assistant message with tool calls
        messages.push(assistantMessage)

        // Add mock tool responses
        for (const toolCall of assistantMessage.tool_calls) {
          const mockResult = getMockToolResult(toolCall.function.name, toolCall.function.arguments)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(mockResult),
          })
          log(`Added mock result for ${toolCall.function.name}`)
        }

        continue
      }

      // Check for text content
      if (assistantMessage.content) {
        log(`Text response (${assistantMessage.content.length} chars):`)
        log(assistantMessage.content)
        log(`\n✅ SUCCESS: Got text response after ${iteration} iterations, ${totalToolCalls} tool calls`)
        return { iterations: iteration, gotTextResponse: true, toolCallCount: totalToolCalls }
      }

      // No tool calls and no content
      log('⚠️ Response has no tool_calls and no content')
      logJson('Full response', response)
      break
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
      break
    }
  }

  log(`❌ FAILED: Hit max iterations (${maxIterations}) - model never returned text`)
  return { iterations: iteration, gotTextResponse: false, toolCallCount: totalToolCalls }
}

const MOCK_TOKEN_DATA: Record<
  string,
  {
    priceUsd: number
    change24hPercent: number
    volume24hUsd: number
    liquidityUsd: number
    ema20: number
    ema50: number
  }
> = {
  BTC: {
    priceUsd: 97500,
    change24hPercent: 1.8,
    volume24hUsd: 25000000000,
    liquidityUsd: 500000000,
    ema20: 97000,
    ema50: 95000,
  },
  ETH: {
    priceUsd: 3850,
    change24hPercent: 2.1,
    volume24hUsd: 12000000000,
    liquidityUsd: 300000000,
    ema20: 3800,
    ema50: 3700,
  },
  AERO: {
    priceUsd: 0.85,
    change24hPercent: 2.5,
    volume24hUsd: 5000000,
    liquidityUsd: 15000000,
    ema20: 0.84,
    ema50: 0.82,
  },
  BRETT: {
    priceUsd: 0.12,
    change24hPercent: -3.2,
    volume24hUsd: 2000000,
    liquidityUsd: 8000000,
    ema20: 0.125,
    ema50: 0.13,
  },
  MONKE: {
    priceUsd: 0.0025,
    change24hPercent: 8.5,
    volume24hUsd: 500000,
    liquidityUsd: 1500000,
    ema20: 0.0024,
    ema50: 0.0022,
  },
}

function getMockToolResult(toolName: string, args?: string): unknown {
  let symbol = 'AERO'
  if (args) {
    try {
      const parsed = JSON.parse(args)
      if (parsed.symbol) symbol = parsed.symbol.toUpperCase().replace(/[^A-Z]/g, '')
    } catch {}
  }

  const tokenData = MOCK_TOKEN_DATA[symbol] || MOCK_TOKEN_DATA.AERO

  switch (toolName) {
    case 'getTokenPrice':
      return {
        symbol,
        priceUsd: tokenData.priceUsd,
        change24hPercent: tokenData.change24hPercent,
        volume24hUsd: tokenData.volume24hUsd,
        liquidityUsd: tokenData.liquidityUsd,
      }
    case 'getWalletBalance':
      return {
        balances: [
          { symbol: 'ETH', balance: '0.5', valueUsd: 1925 },
          { symbol: 'USDC', balance: '500', valueUsd: 500 },
        ],
        totalValueUsd: 2425,
      }
    case 'getIndicators':
      return {
        symbol,
        timeframe: '5m',
        indicators: {
          ema20: tokenData.ema20,
          ema50: tokenData.ema50,
          rsi14: 55,
          macd: 0.002,
          macdSignal: 0.001,
        },
      }
    default:
      return { error: 'Unknown tool' }
  }
}

async function main() {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }

  currentLogFile = getLogFile()

  appendFileSync(currentLogFile, `${'#'.repeat(80)}\n`)
  appendFileSync(currentLogFile, `EigenAI GPT System Prompt Variations Test\n`)
  appendFileSync(currentLogFile, `${new Date().toISOString()}\n`)
  appendFileSync(currentLogFile, `Model: ${MODEL_ID}\n`)
  appendFileSync(currentLogFile, `API URL: ${API_URL}\n\n`)

  console.log(`\n🚀 Running GPT system prompt variation tests\n`)
  console.log(`Model: ${MODEL_ID}`)
  console.log(`Logs: ${currentLogFile}\n`)

  const results: Array<{
    test: number
    strategy: string
    iterations: number
    gotTextResponse: boolean
    toolCallCount: number
  }> = []

  // Run each strategy test
  for (let i = 0; i < SYSTEM_PROMPTS.length; i++) {
    const { name, prompt } = SYSTEM_PROMPTS[i]
    // For GPT: NEVER include tools - we're trying to force text-only output
    const includeTools = false

    const result = await runTest(i + 1, name, prompt, includeTools)
    results.push({
      test: i + 1,
      strategy: name,
      ...result,
    })
  }

  // Summary
  log(`\n${'='.repeat(80)}`)
  log('SUMMARY')
  log('='.repeat(80))
  log('\n| Test | Strategy | Tools Provided | Tool Calls | Iterations | Got Text |')
  log('|------|----------|----------------|------------|------------|----------|')
  for (const r of results) {
    const toolsProvided = r.strategy !== 'TOOL_FREE_DECISION' ? 'Yes' : 'No'
    log(
      `| ${r.test} | ${r.strategy.padEnd(22)} | ${toolsProvided.padEnd(14)} | ${String(r.toolCallCount).padEnd(10)} | ${String(r.iterations).padEnd(10)} | ${r.gotTextResponse ? '✅' : '❌'} |`
    )
  }

  const successCount = results.filter((r) => r.gotTextResponse).length
  log(`\nSuccess rate: ${successCount}/${results.length}`)
  log(`Results written to: ${currentLogFile}`)

  console.log(`\n✅ All tests complete. Success: ${successCount}/${results.length}`)
}

main().catch(console.error)
