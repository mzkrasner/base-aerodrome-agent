# Building an AI Trading Agent for Aerodrome DEX

## Overview

This document outlines how to build an AI agent that can execute trades on Aerodrome DEX on Base chain using its own wallet. It draws from architectural patterns used in the Hyperliquid perps trading agent while adapting them for spot DEX trading.

---

## Part 1: Agent Architecture and Data Flow

### High-Level Architecture

An effective trading agent follows this loop pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT LOOP                               │
├─────────────────────────────────────────────────────────────────┤
│  1. GATHER STATE                                                │
│     ├── Account: balances, positions, recent trades            │
│     ├── Market Data: prices, indicators, liquidity             │
│     ├── Sentiment: X/Twitter, news, whale activity             │
│     └── On-Chain: DEX pools, gas prices, mempool               │
│                                                                 │
│  2. BUILD CONTEXT (structured JSON for LLM)                     │
│     ├── Current Time + Invocation Count                        │
│     ├── Account Dashboard                                      │
│     ├── Per-Asset Market Sections                              │
│     ├── Sentiment Observations                                 │
│     └── Instructions + Asset List                              │
│                                                                 │
│  3. LLM DECISION                                                │
│     ├── Analyze context with system prompt glossary            │
│     ├── Tool calls for additional data (optional)              │
│     └── Return structured trade decisions per asset            │
│                                                                 │
│  4. EXECUTE TRADES                                              │
│     ├── Validate decisions (min size, slippage)                │
│     ├── Approve tokens if needed                               │
│     ├── Execute swaps with retry logic                         │
│     └── Log to diary                                           │
│                                                                 │
│  5. SLEEP until next interval                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Subsystems

| Subsystem            | Purpose                                 | Aerodrome Equivalent                 |
| -------------------- | --------------------------------------- | ------------------------------------ |
| Config/Env           | Centralized runtime settings            | API keys, RPC URLs, assets, interval |
| Context Builder      | Prepares LLM prompt with all data       | Market data + DEX state + sentiment  |
| Decision Engine      | LLM produces structured trade decisions | Same pattern applies                 |
| Risk/Collateral Gate | Validates proposed allocations          | Balance checks, slippage limits      |
| Execution Layer      | Submits transactions                    | Aerodrome Router swaps               |
| Reconciliation       | Tracks pending txs, confirms fills      | Wait for receipts, update balances   |
| Observability        | Logging and monitoring                  | Diary, metrics API                   |

---

## Part 2: Data Sources for Aerodrome Agent

### 2.1 Price and Candle Data (Technical Indicators)

**Primary Options:**

| Provider                         | Data Available                                 | API Type  | Rate Limits   |
| -------------------------------- | ---------------------------------------------- | --------- | ------------- |
| **CoinGecko**                    | OHLCV (daily/hourly/minutely) for Base tokens  | REST      | Tiered        |
| **GoldRush (Covalent)**          | OHLCV + streaming WebSocket                    | REST + WS | Generous      |
| **QuickNode Crypto Market Data** | OHLCV at custom intervals (powered by CoinAPI) | REST      | Based on plan |
| **Bitquery**                     | GraphQL for Aerodrome-specific trade data      | GraphQL   | Tiered        |
| **DexScreener**                  | Token prices, charts, pair data                | REST      | Rate limited  |

**Implementation Pattern (from Hyperliquid agent):**

```typescript
interface CandleData {
  o: number // Open
  h: number // High
  l: number // Low
  c: number // Close
  v: number // Volume
  t: number // Timestamp
}

class AerodromeIndicators {
  private candleCache: Map<string, CandleData[]> = new Map()

  async getCandles(
    tokenAddress: string,
    interval: string, // "5m", "1h", "4h"
    numCandles: number = 100
  ): Promise<CandleData[]> {
    // Fetch from CoinGecko, GoldRush, or aggregate from DEX trades
  }

  calculateEMA(prices: number[], period: number): number | null {
    /* ... */
  }
  calculateRSI(prices: number[], period: number): number | null {
    /* ... */
  }
  calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    /* ... */
  }
  calculateVWAP(candles: CandleData[], lookback: number): number | null {
    /* ... */
  }

  calculateMarketMetrics(candles: CandleData[], indicators: Record<string, number>): MarketMetrics {
    // Returns: ema_separation_ratio, price_velocity, volatility_ratio,
    // consecutive_green/red_candles, range_position_20, volume_ratio_20, etc.
  }
}
```

### 2.2 DEX-Specific Data (Liquidity, Pools, Quotes)

**Aerodrome Data Sources:**

| Source                             | What It Provides                                     | How to Access                  |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------ |
| **Aerodrome Swap API (QuickNode)** | Quotes, pool liquidity, swap execution               | REST add-on for Base endpoints |
| **Bitquery Aerodrome API**         | Real-time DEX trades, pool events, liquidity metrics | GraphQL + Subscriptions        |
| **Expand.network**                 | Price quotes, liquidity queries, routing             | REST                           |
| **Direct Contract Calls**          | `getAmountsOut()`, pool reserves                     | ethers.js/viem                 |
| **Aerodrome MCP Server**           | Full toolkit (swaps, pools, CL)                      | MCP protocol                   |

**Key Metrics to Fetch:**

```typescript
interface PoolMetrics {
  // Pool state
  reserve0: bigint
  reserve1: bigint
  totalLiquidity: number // USD value

  // Price impact
  priceImpact1ETH: number // Impact for 1 ETH swap
  priceImpact10ETH: number // Impact for 10 ETH swap

  // Trading activity
  volume24h: number
  volume7d: number
  trades24h: number

  // Pool type
  isStable: boolean
  fee: number
}

interface QuoteResult {
  amountOut: bigint
  priceImpact: number
  route: Route[]
  gasEstimate: bigint
}
```

### 2.3 Sentiment Data (Social + News)

**Primary Options:**

| Source                       | What It Provides                               | Best For                      |
| ---------------------------- | ---------------------------------------------- | ----------------------------- |
| **Grok API (X Live Search)** | Real-time X/Twitter sentiment with citations   | Asset-specific sentiment      |
| **LunarCrush**               | Social engagement metrics, influencer tracking | Aggregated social scores      |
| **Santiment**                | Social volume, sentiment, dev activity         | On-chain + social correlation |
| **Custom News Aggregation**  | RSS/API feeds from crypto news sites           | Macro context                 |

**Sentiment Data Structure (from Hyperliquid agent):**

```typescript
interface SentimentObservations {
  observations: {
    [asset: string]: {
      post_themes: string[] // ["accumulation", "breakout speculation"]
      sentiment_words: string[] // Actual language from posts
      volume_metrics: {
        current_posts_per_hour: number
        avg_posts_per_hour_baseline: number
        volume_ratio: number
        spike_detected: boolean
        unusual_activity_description: string
      }
      sentiment_velocity: {
        '15min_sentiment_shift': string // "getting more bullish"
        '1hr_sentiment_shift': string
        momentum_description: string // "accelerating"
        notable_shift_events: string[]
      }
      whale_activity: {
        large_transfers_mentioned: string[]
        whale_sentiment: string
        institutional_mentions: string[]
        smart_money_signals: string[]
      }
      notable_accounts: string[]
      fear_greed_mentions: string
      price_expectations: string[] // Specific targets mentioned
    }
  }
  citations: string[] // Source URLs
  search_metadata: {
    posts_analyzed: number
    time_windows_checked: string
    data_freshness: string
  }
}
```

### 2.4 On-Chain Data (Whale Activity, Gas)

**Monitoring Services:**

| Service                          | Capabilities                        | Integration           |
| -------------------------------- | ----------------------------------- | --------------------- |
| **Cryptocurrency Alerting**      | Wallet watch, large transfer alerts | Webhooks              |
| **Bitquery Balance Updates API** | Real-time balance changes           | GraphQL subscriptions |
| **Space and Time (SXT)**         | Custom queries on indexed Base data | SQL-like queries      |
| **Alchemy Webhooks**             | Address activity, token transfers   | Webhooks              |

**Gas Price APIs:**

| Provider                  | Features                                          |
| ------------------------- | ------------------------------------------------- |
| **Blocknative Gas API**   | Confidence intervals, block inclusion probability |
| **Infura Gas API**        | EIP-1559 suggestions, dynamic fees                |
| **BaseScan Gas Tracker**  | Simple current fees                               |
| **QuickNode Gas Tracker** | Historical trends, planning                       |

### 2.5 DEX Aggregator Integration

For optimal routing across multiple DEXs:

| Aggregator    | Volume (Base)   | Features                  |
| ------------- | --------------- | ------------------------- |
| **0x**        | Highest on Base | Smart routing, RFQ        |
| **KyberSwap** | High            | Cross-chain, limit orders |
| **ODOS**      | Growing         | Split routing             |
| **LI.FI**     | Bridge + DEX    | Cross-chain swaps         |
| **Matcha**    | User-friendly   | Limit orders              |

---

## Part 3: Context Building for LLM

### 3.1 Context Payload Structure

The Hyperliquid agent uses an `OrderedDict` to build a structured context. For Aerodrome:

```typescript
interface AgentContext {
  invocation: {
    minutes_since_start: number
    current_time: string // ISO timestamp
    invocation_count: number
  }

  account: {
    total_portfolio_value_usd: number
    eth_balance: number
    token_balances: Array<{
      symbol: string
      address: string
      balance: number
      value_usd: number
    }>
    recent_trades: Array<{
      timestamp: string
      type: 'buy' | 'sell'
      token_in: string
      token_out: string
      amount_in: number
      amount_out: number
      tx_hash: string
    }>
    pending_transactions: string[]
  }

  market_data: Array<{
    asset: string
    token_address: string
    current_price: number

    intraday: {
      // 5m timeframe
      ema20: number
      ema50: number
      rsi7: number
      rsi14: number
      macd: number
      macd_signal: number
      vwap: number
      market_metrics: MarketMetrics
      series: {
        ema20: number[]
        rsi14: number[]
        macd: number[]
      }
    }

    long_term: {
      // 4h timeframe
      ema20: number
      ema50: number
      rsi14: number
      macd: number
      vwap: number
      market_metrics: MarketMetrics
    }

    dex_metrics: {
      pool_liquidity_usd: number
      volume_24h: number
      price_impact_1eth: number
      pool_type: 'stable' | 'volatile'
    }

    recent_price_history: Array<{ t: string; price: number }>
  }>

  x_observations: SentimentObservations | { note: string }

  market_context:
    | {
        regulatory_events: string[]
        institutional_activity: string[]
        macro_factors: string[]
        market_sentiment: string
        notable_events: string[]
        risk_factors: string[]
      }
    | { note: string }

  gas_metrics: {
    base_fee_gwei: number
    priority_fee_gwei: number
    estimated_swap_cost_usd: number
    network_congestion: 'low' | 'medium' | 'high'
  }

  instructions: {
    assets: string[]
    requirement: string
  }
}
```

### 3.2 System Prompt Design

The system prompt should include:

1. **Agent Identity and Mission**
2. **Available Actions** (different from perps!)
3. **Metric Glossary** (explain each field)
4. **Output Contract** (strict JSON schema)

```typescript
const systemPrompt = `
You are an autonomous crypto trading agent managing a live portfolio on Aerodrome DEX (Base chain).
Mission: Maximize returns through intelligent spot trading.

You will receive market + account context for SEVERAL assets, including:
- assets = ${JSON.stringify(assets)}
- per-asset intraday (5m) and longer-term (4h) technical indicators
- DEX-specific metrics (liquidity, volume, price impact)
- Current portfolio holdings
- Recent trading history
- X/Twitter observations (when available)
- Market context (regulatory, macro factors)
- Gas prices and network conditions

IMPORTANT: This is SPOT trading, not perpetual futures.
- No leverage
- No funding rates
- No take-profit/stop-loss trigger orders (you must actively manage exits)
- Profits come from buying low and selling high

Trading Actions:
- BUY: Swap ETH or stablecoins for a token. Requires allocation_usd >= $10.
- SELL: Swap a token back to ETH or stablecoins. Can sell partial or full position.
- HOLD: Maintain current position. May provide reasoning for future action.

Key Spot Trading Considerations:
- Price impact: Large orders move price against you. Check dex_metrics.price_impact_1eth.
- Gas costs: Factor in ~$0.01-0.10 per swap. Don't trade if gas > expected profit.
- Liquidity: Low liquidity pools have high slippage. Check pool_liquidity_usd.
- No stop-losses: You must monitor and actively exit losing positions.

Market Metrics Glossary:
• ema_separation_ratio: Distance between EMA20 and EMA50 (positive = 20 above 50)
• price_velocity_5: Rate of price change over 5 periods
• volatility_ratio: Current range vs average (>1 = expanding volatility)
• rsi_distance_from_50: How far RSI is from neutral
• volume_ratio_20: Current volume vs 20-period average
• consecutive_green/red_candles: Streak of same-direction candles

X/Twitter Observations (when available):
• Interpret as observational context, not trading signals
• sentiment_velocity often leads price by 15-60 minutes
• whale_activity may indicate smart money positioning

Output Contract:
Return a JSON object with exactly two properties:
{
  "reasoning": "detailed step-by-step analysis...",
  "trade_decisions": [
    {
      "asset": "TOKEN_SYMBOL",
      "action": "buy" | "sell" | "hold",
      "allocation_usd": 0,  // Amount to trade (0 for hold)
      "rationale": "brief reason for this specific decision"
    }
  ]
}
- trade_decisions array must match the provided assets list order
- Do not emit Markdown or extra properties
`
```

### 3.3 Decision Output Schema

```typescript
interface TradeDecision {
  asset: string
  action: 'buy' | 'sell' | 'hold'
  allocation_usd: number // 0 for hold, >= 10 for buy/sell
  rationale: string
}

interface AgentOutput {
  reasoning: string // Verbose analysis
  trade_decisions: TradeDecision[]
}
```

---

## Part 4: Implementation Patterns

### 4.1 Main Loop Structure

```typescript
async function runAgentLoop(config: AgentConfig): Promise<void> {
  const indicators = new AerodromeIndicators()
  const sentiment = new SentimentAnalyzer(config.grokApiKey)
  const executor = new AerodromeExecutor(config.wallet, config.rpcUrl)
  const decisionMaker = new DecisionMaker(config.llmApiKey, config.model)

  let invocationCount = 0
  const startTime = Date.now()
  const diary: DiaryEntry[] = []

  while (true) {
    invocationCount++

    // 1. GATHER STATE
    const accountState = await executor.getAccountState()
    const marketData = await gatherMarketData(config.assets, indicators)
    const [xObservations, marketContext] = await Promise.all([
      sentiment.getAssetSentiment(config.assets),
      sentiment.getMarketContext(),
    ])
    const gasMetrics = await getGasMetrics(config.rpcUrl)

    // 2. BUILD CONTEXT
    const context: AgentContext = {
      invocation: {
        minutes_since_start: (Date.now() - startTime) / 60000,
        current_time: new Date().toISOString(),
        invocation_count: invocationCount,
      },
      account: accountState,
      market_data: marketData,
      x_observations: xObservations || { note: 'No X data available' },
      market_context: marketContext || { note: 'No market context available' },
      gas_metrics: gasMetrics,
      instructions: {
        assets: config.assets,
        requirement: 'Decide actions for all assets and return strict JSON.',
      },
    }

    // 3. LLM DECISION
    const output = await decisionMaker.decide(config.assets, context)

    // 4. EXECUTE TRADES
    for (const decision of output.trade_decisions) {
      if (decision.action === 'hold') continue

      try {
        const result = await executor.executeSwap(decision, gasMetrics)
        diary.push({
          timestamp: new Date().toISOString(),
          asset: decision.asset,
          action: decision.action,
          allocation_usd: decision.allocation_usd,
          rationale: decision.rationale,
          tx_hash: result.txHash,
          status: result.status,
        })
      } catch (error) {
        console.error(`Execution failed for ${decision.asset}:`, error)
      }
    }

    // 5. SLEEP
    const intervalMs = parseInterval(config.interval)
    await sleep(intervalMs)
  }
}
```

### 4.2 Gathering Market Data

```typescript
async function gatherMarketData(
  assets: string[],
  indicators: AerodromeIndicators
): Promise<MarketDataSection[]> {
  const sections: MarketDataSection[] = []

  for (const asset of assets) {
    // Fetch candles for both timeframes
    const [candles5m, candles4h] = await Promise.all([
      indicators.getCandles(asset, '5m', 100),
      indicators.getCandles(asset, '4h', 100),
    ])

    // Calculate indicators
    const closes5m = candles5m.map((c) => c.c)
    const closes4h = candles4h.map((c) => c.c)

    const intraday = {
      ema20: indicators.calculateEMA(closes5m, 20),
      ema50: indicators.calculateEMA(closes5m, 50),
      rsi7: indicators.calculateRSI(closes5m, 7),
      rsi14: indicators.calculateRSI(closes5m, 14),
      ...indicators.calculateMACD(closes5m),
      vwap: indicators.calculateVWAP(candles5m, 100),
      market_metrics: indicators.calculateMarketMetrics(candles5m, {
        /* indicators */
      }),
    }

    const longTerm = {
      ema20: indicators.calculateEMA(closes4h, 20),
      ema50: indicators.calculateEMA(closes4h, 50),
      rsi14: indicators.calculateRSI(closes4h, 14),
      ...indicators.calculateMACD(closes4h),
      vwap: indicators.calculateVWAP(candles4h, 100),
      market_metrics: indicators.calculateMarketMetrics(candles4h, {
        /* indicators */
      }),
    }

    // Fetch DEX-specific metrics
    const dexMetrics = await getDexMetrics(asset)

    sections.push({
      asset,
      token_address: getTokenAddress(asset),
      current_price: closes5m[closes5m.length - 1],
      intraday,
      long_term: longTerm,
      dex_metrics: dexMetrics,
      recent_price_history: candles5m.slice(-10).map((c) => ({
        t: new Date(c.t).toISOString(),
        price: c.c,
      })),
    })
  }

  return sections
}
```

### 4.3 LLM Decision Maker (with Retry and Sanitization)

```typescript
class DecisionMaker {
  private model: string
  private apiKey: string
  private sanitizeModel: string = 'openai/gpt-4o-mini' // Fast/cheap fallback

  async decide(assets: string[], context: AgentContext): Promise<AgentOutput> {
    const systemPrompt = buildSystemPrompt(assets)
    const userPrompt = JSON.stringify(context)

    // Allow up to 6 attempts (for tool calls)
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await this.callLLM(systemPrompt, userPrompt)
        const parsed = this.parseResponse(response)

        if (this.isValidOutput(parsed, assets)) {
          return parsed
        }

        // Try sanitizer model
        const sanitized = await this.sanitize(response, assets)
        if (sanitized) return sanitized
      } catch (error) {
        console.error(`LLM attempt ${attempt + 1} failed:`, error)
      }
    }

    // Fallback: HOLD everything
    return {
      reasoning: 'Failed to get valid LLM output',
      trade_decisions: assets.map((asset) => ({
        asset,
        action: 'hold' as const,
        allocation_usd: 0,
        rationale: 'LLM error fallback',
      })),
    }
  }

  private async sanitize(rawContent: string, assets: string[]): Promise<AgentOutput | null> {
    // Use a fast/cheap model to normalize malformed JSON
    // ... implementation
  }
}
```

---

## Part 5: Key Differences from Perps

| Aspect             | Perps (Hyperliquid)         | Spot (Aerodrome)               |
| ------------------ | --------------------------- | ------------------------------ |
| Leverage           | 3-10x typical               | 1x only                        |
| Funding Rates      | Critical metric to monitor  | N/A                            |
| TP/SL Orders       | Trigger orders on exchange  | Manual exits required          |
| Position Direction | Long or Short               | Long only (hold tokens)        |
| Exit Strategy      | Can set TP/SL automatically | Must actively monitor and sell |
| Fees               | Maker/Taker fees            | Swap fees + gas                |
| Liquidity Source   | Perp order book             | AMM pools                      |
| Price Impact       | Depends on OI/volume        | Depends on pool depth          |
| Settlement         | Cash-settled                | Token-settled                  |

---

## Aerodrome Contract Addresses (Base Chain)

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| Router V2        | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |
| Universal Router | `0x6Cb442acF35158D5eDa88fe602221b67B400bE3E` |
| WETH             | `0x4200000000000000000000000000000000000006` |

---

## Route Struct

Aerodrome uses a `Route` struct to define swap paths:

```solidity
struct Route {
    address from;      // Input token address
    address to;        // Output token address
    bool stable;       // true for stable pools, false for volatile pools
    address factory;   // Pool factory address (optional, can be address(0))
}
```

**Key Point:** Set `stable: true` for stablecoin pairs (USDC/USDT) and `stable: false` for volatile pairs (ETH/USDC).

---

## Core Swap Functions

### ERC20 to ERC20

```solidity
function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external returns (uint[] memory amounts);
```

### Native ETH to ERC20

```solidity
function swapExactETHForTokens(
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external payable returns (uint[] memory amounts);
```

**Note:** Send ETH value via `msg.value` - the router wraps it internally.

### ERC20 to Native ETH

```solidity
function swapExactTokensForETH(
    uint amountIn,
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external returns (uint[] memory amounts);
```

### Get Quote (Estimate Output)

```solidity
function getAmountsOut(
    uint amountIn,
    Route[] calldata routes
) external view returns (uint[] memory amounts);
```

---

## Implementation with ethers.js

### Setup

```typescript
import { ethers } from 'ethers'

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'
const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org')
const wallet = new ethers.Wallet(privateKey, provider)
```

### Router ABI (Minimal)

```typescript
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
]
```

### Step 1: Approve Token Spending

```typescript
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

async function approveToken(tokenAddress: string, amount: bigint): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)

  // Check existing allowance
  const currentAllowance = await token.allowance(wallet.address, AERODROME_ROUTER)
  if (currentAllowance >= amount) {
    console.log('Already approved')
    return
  }

  const tx = await token.approve(AERODROME_ROUTER, amount)
  await tx.wait()
  console.log('Approval confirmed:', tx.hash)
}
```

### Step 2: Get Quote

```typescript
async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  stable: boolean = false
): Promise<bigint> {
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, provider)

  const route = [
    {
      from: tokenIn,
      to: tokenOut,
      stable: stable,
      factory: ethers.ZeroAddress, // Use default factory
    },
  ]

  const amounts = await router.getAmountsOut(amountIn, route)
  return amounts[amounts.length - 1]
}
```

### Step 3: Execute Swap (ERC20 to ERC20)

```typescript
async function swapTokensForTokens(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippagePercent: number = 0.5,
  stable: boolean = false
): Promise<string> {
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, wallet)

  // Get expected output
  const expectedOut = await getQuote(tokenIn, tokenOut, amountIn, stable)

  // Calculate minimum output with slippage
  const minOut = (expectedOut * BigInt(Math.floor((100 - slippagePercent) * 100))) / 10000n

  const route = [
    {
      from: tokenIn,
      to: tokenOut,
      stable: stable,
      factory: ethers.ZeroAddress,
    },
  ]

  // Deadline: 30 minutes from now
  const deadline = Math.floor(Date.now() / 1000) + 1800

  const tx = await router.swapExactTokensForTokens(
    amountIn,
    minOut,
    route,
    wallet.address,
    deadline
  )

  const receipt = await tx.wait()
  return receipt.hash
}
```

### Step 4: Execute Swap (Native ETH to ERC20)

```typescript
async function swapETHForTokens(
  tokenOut: string,
  ethAmount: bigint,
  slippagePercent: number = 0.5,
  stable: boolean = false
): Promise<string> {
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, wallet)

  // Get expected output (use WETH for quote)
  const expectedOut = await getQuote(WETH, tokenOut, ethAmount, stable)
  const minOut = (expectedOut * BigInt(Math.floor((100 - slippagePercent) * 100))) / 10000n

  const route = [
    {
      from: WETH, // Router wraps ETH to WETH internally
      to: tokenOut,
      stable: stable,
      factory: ethers.ZeroAddress,
    },
  ]

  const deadline = Math.floor(Date.now() / 1000) + 1800

  // Send ETH value with the transaction
  const tx = await router.swapExactETHForTokens(
    minOut,
    route,
    wallet.address,
    deadline,
    { value: ethAmount } // <-- ETH amount sent here
  )

  const receipt = await tx.wait()
  return receipt.hash
}
```

---

## Existing MCP Server

There's already an MCP server for Aerodrome: **[Tairon-ai/aerodrome-finance-mcp](https://github.com/Tairon-ai/aerodrome-finance-mcp)**

### Capabilities:

- Real-time token swaps with slippage protection
- Liquidity pool queries and management
- Concentrated liquidity (CL) support
- Pool analytics

This could be integrated directly if building an AI agent that uses MCP.

---

## Best Practices for AI Trading Agents

### 1. Private Key Security

```typescript
// NEVER hardcode private keys
// Use environment variables or secure key management

// Option 1: Environment variable
const privateKey = process.env.AGENT_PRIVATE_KEY

// Option 2: AWS KMS / Google Cloud KMS
// Option 3: Hardware Security Module (HSM)
// Option 4: Encrypted keystore file with password prompt
```

### 2. Transaction Retry Logic

```typescript
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Don't retry if transaction was rejected by user or nonce issue
      if (error.code === 'ACTION_REJECTED' || error.code === 'NONCE_EXPIRED') {
        throw error
      }

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
```

### 3. Gas Estimation on Base

```typescript
async function estimateGasWithBuffer(
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  bufferPercent: number = 20
): Promise<bigint> {
  const estimated = await contract[method].estimateGas(...args)
  return (estimated * BigInt(100 + bufferPercent)) / 100n
}

// Base uses EIP-1559, so set maxFeePerGas and maxPriorityFeePerGas
async function getGasSettings(provider: ethers.Provider) {
  const feeData = await provider.getFeeData()
  return {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('0.001', 'gwei'),
  }
}
```

### 4. Transaction Monitoring

```typescript
async function waitForConfirmation(
  provider: ethers.Provider,
  txHash: string,
  confirmations: number = 1,
  timeoutMs: number = 60000
): Promise<ethers.TransactionReceipt> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const receipt = await provider.getTransactionReceipt(txHash)

    if (receipt && receipt.confirmations >= confirmations) {
      if (receipt.status === 0) {
        throw new Error(`Transaction reverted: ${txHash}`)
      }
      return receipt
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Transaction timeout: ${txHash}`)
}
```

---

## Multi-Hop Swaps

For tokens without direct pools, use multiple routes:

```typescript
// ETH -> USDC -> AERO (example)
const routes = [
  { from: WETH, to: USDC, stable: false, factory: ethers.ZeroAddress },
  { from: USDC, to: AERO, stable: false, factory: ethers.ZeroAddress },
]
```

---

## Stable vs Volatile Pools

| Pool Type | Use Case                                    | `stable` Value |
| --------- | ------------------------------------------- | -------------- |
| Volatile  | ETH/USDC, token pairs with price volatility | `false`        |
| Stable    | USDC/USDT, pegged assets                    | `true`         |

Stable pools use a different bonding curve optimized for assets that should trade 1:1.

---

## Error Handling

Common errors and how to handle them:

| Error                        | Cause                              | Solution                                 |
| ---------------------------- | ---------------------------------- | ---------------------------------------- |
| `INSUFFICIENT_OUTPUT_AMOUNT` | Slippage exceeded                  | Increase slippage or retry               |
| `EXPIRED`                    | Deadline passed                    | Use longer deadline or retry immediately |
| `INSUFFICIENT_LIQUIDITY`     | Pool doesn't have enough liquidity | Use different route or smaller amount    |
| `TRANSFER_FROM_FAILED`       | Token approval insufficient        | Re-approve with higher amount            |

---

---

## Part 6: Recommended Data Source Stack

### Minimum Viable Agent

| Data Type        | Recommended Source                      | Cost                |
| ---------------- | --------------------------------------- | ------------------- |
| **Prices/OHLCV** | CoinGecko API                           | Free tier available |
| **DEX Quotes**   | Direct contract calls (`getAmountsOut`) | Gas only            |
| **Execution**    | Aerodrome Router                        | Gas only            |
| **Gas Prices**   | `eth_gasPrice` RPC call                 | Free                |

### Production Agent

| Data Type          | Primary                  | Backup           |
| ------------------ | ------------------------ | ---------------- |
| **Prices/OHLCV**   | GoldRush (streaming)     | CoinGecko        |
| **DEX Quotes**     | QuickNode Aerodrome API  | Direct calls     |
| **Sentiment**      | Grok API (X Live Search) | LunarCrush       |
| **Whale Tracking** | Bitquery subscriptions   | Alchemy webhooks |
| **Gas**            | Blocknative              | Infura Gas API   |
| **Aggregation**    | 0x API                   | KyberSwap        |

### API Key Requirements

```bash
# .env file
# Required
AGENT_PRIVATE_KEY=         # Wallet for trading
RPC_URL=                   # Base RPC (Alchemy, QuickNode, etc.)
LLM_API_KEY=               # OpenRouter, OpenAI, or Anthropic

# Price Data (pick one)
COINGECKO_API_KEY=         # Free tier works for MVP
GOLDRUSH_API_KEY=          # Better for streaming

# Sentiment (optional but recommended)
GROK_API_KEY=              # X/Twitter sentiment via Grok

# DEX Optimization (optional)
QUICKNODE_AERODROME_API=   # Simplified DEX integration
ZEROX_API_KEY=             # Aggregator routing

# Monitoring (optional)
BITQUERY_API_KEY=          # GraphQL for on-chain data
BLOCKNATIVE_API_KEY=       # Gas prediction
```

---

## Part 7: Quick Reference

### Common Token Addresses (Base)

| Token           | Address                                      |
| --------------- | -------------------------------------------- |
| WETH            | `0x4200000000000000000000000000000000000006` |
| USDC            | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDbC (bridged) | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` |
| AERO            | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |
| cbETH           | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |
| DAI             | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` |

### Aerodrome Contracts

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| Router V2        | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |
| Universal Router | `0x6Cb442acF35158D5eDa88fe602221b67B400bE3E` |
| Voter            | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` |
| AERO Token       | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |

### API Endpoints

| Service            | Endpoint                                                         |
| ------------------ | ---------------------------------------------------------------- |
| CoinGecko Base     | `https://api.coingecko.com/api/v3/coins/base/contract/{address}` |
| GoldRush           | `https://api.covalenthq.com/v1/base-mainnet/`                    |
| Bitquery           | `https://graphql.bitquery.io/`                                   |
| 0x                 | `https://base.api.0x.org/swap/v1/`                               |
| QuickNode (varies) | Your endpoint + `/addon/aerodrome/`                              |

---

## References

- [Aerodrome Contracts GitHub](https://github.com/aerodrome-finance/contracts)
- [BaseScan Router Contract](https://basescan.org/address/0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43)
- [Tairon-ai Aerodrome MCP](https://github.com/Tairon-ai/aerodrome-finance-mcp)
- [Bitquery Aerodrome API Docs](https://docs.bitquery.io/docs/blockchain/Base/aerodrome-base-api/)
- [QuickNode Aerodrome Guide](https://www.quicknode.com/guides/base/what-is-aerodrome)
- [CoinGecko Base API](https://www.coingecko.com/en/api/base)
- [GoldRush Base API](https://goldrush.dev/chains/base/)
- [0x API Documentation](https://0x.org/docs/api)
- [Blocknative Gas API](https://docs.blocknative.com/gas-prediction/gas-platform)
