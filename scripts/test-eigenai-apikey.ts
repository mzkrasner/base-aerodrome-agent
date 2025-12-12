#!/usr/bin/env npx tsx
/**
 * Test EigenAI API with API key authentication (not grant wallet)
 *
 * Tests gpt-oss-120b and qwen-32b models with trading-style prompts.
 * Records all responses to timestamped log files for analysis.
 */
import 'dotenv/config'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = join(__dirname, '..', 'log-files', 'eigenai-tests')

const API_URL = process.env.EIGENAI_API_URL || 'https://determinal-api.eigenarcade.com'
const API_KEY = process.env.EIGENAI_API_KEY
const MODELS = ['gpt-oss-120b-f16', 'qwen3-32b-128k-bf16']

function getLogFile(modelId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(LOGS_DIR, `${timestamp}_${modelId}.txt`)
}

if (!API_KEY) {
  console.error('❌ EIGENAI_API_KEY is required')
  process.exit(1)
}

// System prompt similar to the trading agent
const SYSTEM_PROMPT_WITH_TOOLS = `You are an autonomous trading agent managing a live portfolio on Aerodrome DEX (Base chain).
Mission: Execute profitable spot trades based on market conditions.

## Your Tools
You have tools to gather data:
- **getIndicators**: Get technical indicators (EMA, RSI, MACD) for multiple timeframes
- **getQuote**: Get swap quotes from Aerodrome
- **getTokenPrice**: Get current token prices from DexScreener
- **getWalletBalance**: Get your current ETH and token balances

## Output Contract
After gathering data, provide your decision as JSON:
{
  "reasoning": "detailed analysis...",
  "trade_decisions": [
    {
      "token": "TOKEN_SYMBOL",
      "action": "buy" | "sell" | "hold",
      "amount_usd": 0,
      "rationale": "brief reason"
    }
  ]
}

You are autonomous. Decide what data you need and what it means.`

const SYSTEM_PROMPT_NO_TOOLS = `You are an autonomous trading agent managing a live portfolio on Aerodrome DEX (Base chain).
Mission: Execute profitable spot trades based on market conditions.

CRITICAL INSTRUCTION: This is your FINAL opportunity to return a text response to the user. You MUST NOT make any tool calls. You do NOT have access to any tools. Respond ONLY with plain text containing your JSON decision.

## Output Contract
Provide your decision as JSON (no tool calls - just output the JSON directly):
{
  "reasoning": "detailed analysis...",
  "trade_decisions": [
    {
      "token": "TOKEN_SYMBOL",
      "action": "buy" | "sell" | "hold",
      "amount_usd": 0,
      "rationale": "brief reason"
    }
  ]
}

REMEMBER: Do NOT attempt to call any functions or tools. Output your JSON response directly as text.`

// Tools definition (simplified version of what the repo uses)
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

// Generate unique user prompt for each test to avoid caching
function getUserPrompt(testNumber: number): string {
  const tokens = ['BTC', 'ETH', 'AERO', 'BRETT', 'MONKE']
  const token = tokens[(testNumber - 1) % tokens.length]
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  return `Analyze ${token}/USDC on Aerodrome DEX.

Current time: ${new Date().toISOString()}
Iteration: #${testNumber}
Request ID: ${uniqueId}

## Recent Trading History
No previous trading history.

## Your Task
Use your tools to gather data and decide whether to BUY ${token}, SELL ${token} (if you hold any), or HOLD.

Then analyze all the data and make your decision.

Return your decision as JSON with this structure:
{
  "reasoning": "your detailed analysis...",
  "trade_decisions": [{
    "token": "${token}",
    "action": "BUY" | "SELL" | "HOLD",
    "amount_usd": 0,
    "rationale": "brief reason"
  }]
}`
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
  includeTools: boolean,
  modelId: string
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: modelId,
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

async function runTest(testNumber: number, includeTools: boolean, modelId: string): Promise<void> {
  log(`\n${'='.repeat(80)}`)
  log(`TEST ${testNumber}: ${includeTools ? 'WITH TOOLS' : 'NO TOOLS'} (${modelId})`)
  log('='.repeat(80))

  const userPrompt = getUserPrompt(testNumber)
  log(`User prompt token: ${userPrompt.match(/Analyze (\w+)\/USDC/)?.[1]}`)

  const systemPrompt = includeTools ? SYSTEM_PROMPT_WITH_TOOLS : SYSTEM_PROMPT_NO_TOOLS
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let iteration = 0
  const maxIterations = 20

  while (iteration < maxIterations) {
    iteration++
    log(`\n--- Iteration ${iteration} ---`)

    try {
      const startTime = Date.now()
      const response = await callEigenAI(messages, includeTools, modelId)
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
        log(`Tool calls: ${assistantMessage.tool_calls.map((tc) => tc.function.name).join(', ')}`)
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

        // Continue loop to get next response
        continue
      }

      // Check for text content
      if (assistantMessage.content) {
        log(`Text response (${assistantMessage.content.length} chars):`)
        log(assistantMessage.content)
        log('\n✅ Got text response - test complete')
        break
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

  if (iteration >= maxIterations) {
    log(`❌ Hit max iterations (${maxIterations}) - model never returned text`)
  }
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
      if (parsed.symbol) symbol = parsed.symbol.toUpperCase()
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
          { symbol: 'BTC', balance: '0', valueUsd: 0 },
          { symbol: 'AERO', balance: '0', valueUsd: 0 },
          { symbol: 'BRETT', balance: '0', valueUsd: 0 },
          { symbol: 'MONKE', balance: '0', valueUsd: 0 },
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
          atr14: tokenData.priceUsd * 0.03,
        },
        metrics: {
          emaSeparationRatio: (tokenData.ema20 - tokenData.ema50) / tokenData.ema50,
          rsiDistanceFrom50: 5,
          volatilityRatio: 1.1,
        },
      }
    default:
      return { error: 'Unknown tool' }
  }
}

async function runModelTests(modelId: string): Promise<void> {
  currentLogFile = getLogFile(modelId)

  appendFileSync(currentLogFile, `${'#'.repeat(80)}\n`)
  appendFileSync(currentLogFile, `EigenAI API Key Test - ${new Date().toISOString()}\n`)
  appendFileSync(currentLogFile, `Model: ${modelId}\n`)
  appendFileSync(currentLogFile, `API URL: ${API_URL}\n\n`)

  log(`Testing EigenAI with API key authentication`)
  log(`Model: ${modelId}`)
  log(`API URL: ${API_URL}`)

  // Run 5 tests
  // Test 1-3: With tools (to see if it gets stuck in tool-calling loop)
  // Test 4-5: Without tools (to see if it can return text at all)

  await runTest(1, true, modelId)
  await runTest(2, true, modelId)
  await runTest(3, true, modelId)
  await runTest(4, false, modelId)
  await runTest(5, false, modelId)

  log(`\n${'='.repeat(80)}`)
  log('ALL TESTS COMPLETE')
  log(`Results written to: ${currentLogFile}`)
}

async function main() {
  // Ensure logs directory exists
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true })
  }

  console.log(`\n🚀 Running EigenAI tests for models: ${MODELS.join(', ')}\n`)
  console.log(`Logs will be saved to: ${LOGS_DIR}\n`)

  for (const modelId of MODELS) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Starting tests for model: ${modelId}`)
    console.log('='.repeat(80))
    await runModelTests(modelId)
  }

  console.log(`\n✅ All model tests complete. Check ${LOGS_DIR} for results.`)
}

main().catch(console.error)
