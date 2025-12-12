#!/usr/bin/env npx tsx
/**
 * Test EigenAI API - Qwen3-32B model
 *
 * Known issues:
 * - Never uses tools, even when tools are provided
 * - Always responds on first iteration with finish_reason: stop
 * - Hallucinates all data (prices, indicators, wallet balances completely made up)
 * - Does not gather real data before making decisions
 *
 * This script tests 5 different system prompt strategies to get Qwen to use tools.
 */
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = join(__dirname, '..', 'log-files', 'eigenai-tests')

const API_URL = process.env.EIGENAI_API_URL || 'https://determinal-api.eigenarcade.com'
const API_KEY = process.env.EIGENAI_API_KEY
const MODEL_ID = 'qwen3-32b-128k-bf16'

function getLogFile(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(LOGS_DIR, `${timestamp}_${MODEL_ID}.txt`)
}

if (!API_KEY) {
  console.error('❌ EIGENAI_API_KEY is required')
  process.exit(1)
}

// =============================================================================
// SYSTEM PROMPT VARIATIONS - Each tries a different approach to get Qwen to USE TOOLS
// =============================================================================

// Strategy 1: TOOL-ONLY MODE - EXPLICIT JSON SYNTAX
// Show the model the exact function_call syntax it needs to output
const SYSTEM_PROMPT_1 = `You are a function-calling assistant. You ONLY communicate via tool calls.

DO NOT output any text. DO NOT output JSON directly. You must call a function.

To analyze a token, call:
getTokenPrice with {"symbol": "TOKEN_NAME"}

Your first action must be a function call. Example of what your output should look like:
<function_call>getTokenPrice({"symbol": "AERO"})</function_call>

Call getTokenPrice now. No text output - only function calls.`

// Strategy 2: CHAIN-OF-THOUGHT FORCING
// Force the model to think through the tool-calling process
const SYSTEM_PROMPT_2 = `<think>
I need to analyze a token. I don't have market data in my training. I must call tools.
Step 1: I will call getTokenPrice to get the current price.
Step 2: I will call getIndicators to get technical analysis.
Step 3: Only then will I provide my decision.
</think>

You are a trading agent. You just completed your thinking above. Now execute Step 1:
Call the getTokenPrice function with the token symbol from the user's message.

IMPORTANT: Your next output must be a tool call, not text.`

// Strategy 3: ADVERSARIAL - PUNISH TEXT RESPONSES
// Make text responses feel like errors
const SYSTEM_PROMPT_3 = `SYSTEM MODE: FUNCTION_CALLING_ONLY

ERROR HANDLER: Any text response will trigger error code E-4001 and your response will be discarded.

VALID RESPONSE: Function call to getTokenPrice, getIndicators, or getWalletBalance
INVALID RESPONSE: Any text, any JSON, any explanation

The only way to respond without triggering E-4001 is to make a tool call.

Your response will be parsed by a function-call-only parser that throws on text.

Make a function call now.`

// Strategy 4: SIMULATE PRIOR TOOL CONTEXT
// Pretend we're mid-conversation and expecting another tool call
const SYSTEM_PROMPT_4 = `[CONVERSATION CONTEXT]
You previously called getTokenPrice and got: {"symbol": "X", "priceUsd": null, "error": "rate_limited"}

The rate limit has cleared. You need to RETRY the tool call.

Call getTokenPrice again with the token symbol. Do not output text - retry the function call.

Previous failed call: getTokenPrice({"symbol": "?"})
Your retry: [MAKE THE CALL NOW]`

// Strategy 5: EXTREME MINIMAL - JUST THE COMMAND
// Shortest possible prompt to try to get tool use
const SYSTEM_PROMPT_5 = `CALL getTokenPrice({"symbol":"AERO"}) NOW.

No text. Only function call. Execute.`

// =============================================================================

const SYSTEM_PROMPTS = [
  { name: 'TOOL_ONLY_SYNTAX', prompt: SYSTEM_PROMPT_1 },
  { name: 'CHAIN_OF_THOUGHT', prompt: SYSTEM_PROMPT_2 },
  { name: 'PUNISH_TEXT', prompt: SYSTEM_PROMPT_3 },
  { name: 'SIMULATE_RETRY', prompt: SYSTEM_PROMPT_4 },
  { name: 'EXTREME_MINIMAL', prompt: SYSTEM_PROMPT_5 },
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

Use your tools to get current data for ${token}, then decide: BUY, SELL, or HOLD.`
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

async function callEigenAI(messages: ChatMessage[], forceToolUse: boolean = false): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: MODEL_ID,
    messages,
    max_tokens: 4096,
    apiKey: API_KEY,
    tools: TOOLS,
    // Try forcing tool use at API level
    tool_choice: forceToolUse ? 'required' : 'auto',
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
  forceToolUse: boolean = false
): Promise<{
  iterations: number
  usedTools: boolean
  toolCallCount: number
  hallucinatedData: boolean
  responsePreview: string
}> {
  log(`\n${'='.repeat(80)}`)
  log(`TEST ${testNumber}: ${strategyName} (${MODEL_ID})`)
  log(`Force tool_choice=required: ${forceToolUse}`)
  log('='.repeat(80))
  log(`System prompt:\n${systemPrompt}\n`)

  const userPrompt = getUserPrompt(testNumber)
  const token = userPrompt.match(/Analyze (\w+)\/USDC/)?.[1] || 'UNKNOWN'
  log(`User prompt token: ${token}`)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let iteration = 0
  let totalToolCalls = 0
  const maxIterations = 10
  let responseContent = ''

  while (iteration < maxIterations) {
    iteration++
    log(`\n--- Iteration ${iteration} ---`)

    try {
      const startTime = Date.now()
      const response = await callEigenAI(messages, forceToolUse)
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
          `🎉 TOOL CALLS: ${assistantMessage.tool_calls.map((tc) => tc.function.name).join(', ')} (total: ${totalToolCalls})`
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
        responseContent = assistantMessage.content
        log(`Text response (${responseContent.length} chars):`)
        log(responseContent)

        if (totalToolCalls === 0) {
          log(`\n⚠️ WARNING: Responded without using any tools!`)
        } else {
          log(`\n✅ Got response after ${totalToolCalls} tool calls`)
        }
        break
      }

      log('⚠️ Response has no tool_calls and no content')
      break
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
      break
    }
  }

  // Check if response contains hallucinated data
  const hallucinatedData = checkForHallucination(responseContent, token, totalToolCalls)

  return {
    iterations: iteration,
    usedTools: totalToolCalls > 0,
    toolCallCount: totalToolCalls,
    hallucinatedData,
    responsePreview: responseContent.slice(0, 200),
  }
}

// Check if the response contains made-up data that doesn't match our mock data
function checkForHallucination(
  response: string,
  token: string,
  toolCallCount: number
): boolean {
  if (toolCallCount > 0) {
    // If tools were called, check if response uses the mock data values
    const mockData = MOCK_TOKEN_DATA[token] || MOCK_TOKEN_DATA.AERO

    // Look for mock price in response (with some tolerance for formatting)
    const priceStr = mockData.priceUsd.toString()
    if (response.includes(priceStr) || response.includes(priceStr.replace('.', ','))) {
      return false // Data matches mock = not hallucinated
    }
  }

  // If no tools called or data doesn't match, check for signs of hallucination
  const hallucinationPatterns = [
    /\$\d+[\d,]*\.\d{2}/, // Any dollar amount (likely made up)
    /EMA.*(?:20|50).*\d+/, // EMA values
    /RSI.*\d{2}/, // RSI values
    /price.*\$?\d+/i, // Price mentions
  ]

  for (const pattern of hallucinationPatterns) {
    if (pattern.test(response)) {
      return true
    }
  }

  return false
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
  appendFileSync(currentLogFile, `EigenAI Qwen System Prompt Variations Test\n`)
  appendFileSync(currentLogFile, `${new Date().toISOString()}\n`)
  appendFileSync(currentLogFile, `Model: ${MODEL_ID}\n`)
  appendFileSync(currentLogFile, `API URL: ${API_URL}\n\n`)

  console.log(`\n🚀 Running Qwen system prompt variation tests\n`)
  console.log(`Model: ${MODEL_ID}`)
  console.log(`Logs: ${currentLogFile}\n`)

  const results: Array<{
    test: number
    strategy: string
    usedTools: boolean
    toolCallCount: number
    hallucinatedData: boolean
  }> = []

  // Run each strategy test with tool_choice=auto first
  for (let i = 0; i < SYSTEM_PROMPTS.length; i++) {
    const { name, prompt } = SYSTEM_PROMPTS[i]
    const result = await runTest(i + 1, name, prompt, false)
    results.push({
      test: i + 1,
      strategy: name,
      usedTools: result.usedTools,
      toolCallCount: result.toolCallCount,
      hallucinatedData: result.hallucinatedData,
    })
  }

  // Run one more test with tool_choice=required to force tool use at API level
  log(`\n${'#'.repeat(80)}`)
  log(`BONUS TEST: Using tool_choice="required" at API level`)
  log('#'.repeat(80))
  const forcedResult = await runTest(6, 'FORCE_REQUIRED_API', SYSTEM_PROMPTS[0].prompt, true)
  results.push({
    test: 6,
    strategy: 'FORCE_REQUIRED_API',
    usedTools: forcedResult.usedTools,
    toolCallCount: forcedResult.toolCallCount,
    hallucinatedData: forcedResult.hallucinatedData,
  })

  // Summary
  log(`\n${'='.repeat(80)}`)
  log('SUMMARY')
  log('='.repeat(80))
  log('\n| Test | Strategy | Used Tools | Tool Calls | Hallucinated |')
  log('|------|----------|------------|------------|--------------|')
  for (const r of results) {
    log(
      `| ${r.test} | ${r.strategy.slice(0, 24).padEnd(24)} | ${r.usedTools ? '✅' : '❌'}          | ${String(r.toolCallCount).padEnd(10)} | ${r.hallucinatedData ? '⚠️ Yes' : '✅ No'}       |`
    )
  }

  const toolUseCount = results.filter((r) => r.usedTools).length
  const noHallucinationCount = results.filter((r) => !r.hallucinatedData).length

  log(`\nTool usage rate: ${toolUseCount}/${results.length}`)
  log(`No hallucination rate: ${noHallucinationCount}/${results.length}`)
  log(`Results written to: ${currentLogFile}`)

  console.log(`\n✅ Tests complete. Tool use: ${toolUseCount}/${results.length}, Clean data: ${noHallucinationCount}/${results.length}`)
}

main().catch(console.error)
