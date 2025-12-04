# Aerodrome Trading Agent: Technical Reference

## Overview

This document provides technical reference for building an AI trading agent for Aerodrome DEX on Base chain. It covers data sources, contract interfaces, and implementation patterns.

---

## Part 1: Agent Architecture and Data Flow

### High-Level Architecture

The trading agent follows this loop pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT LOOP                               │
├─────────────────────────────────────────────────────────────────┤
│  1. GATHER STATE                                                │
│     ├── Account: balances, recent trades                        │
│     ├── Market Data: prices, indicators, liquidity              │
│     ├── Sentiment: X/Twitter, whale activity                    │
│     └── On-Chain: DEX pools, gas prices                         │
│                                                                 │
│  2. BUILD CONTEXT (structured JSON for LLM)                     │
│     ├── Current Time + Iteration Count                          │
│     ├── Account Dashboard                                       │
│     ├── Per-Asset Market Sections                               │
│     ├── Sentiment Observations                                  │
│     └── Instructions + Asset List                               │
│                                                                 │
│  3. LLM DECISION                                                │
│     ├── Analyze context with system prompt glossary             │
│     ├── Tool calls for additional data (iterative)              │
│     └── Return structured trade decisions per asset             │
│                                                                 │
│  4. EXECUTE TRADES                                              │
│     ├── Validate decisions (min size, slippage)                 │
│     ├── Approve tokens if needed                                │
│     ├── Execute swaps with retry logic                          │
│     └── Log to diary                                            │
│                                                                 │
│  5. SLEEP until next interval                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Subsystems

| Subsystem            | Purpose                                 | Implementation                       |
| -------------------- | --------------------------------------- | ------------------------------------ |
| Config/Env           | Centralized runtime settings            | API keys, RPC URLs, assets, interval |
| Context Builder      | Prepares LLM prompt with all data       | Market data + DEX state + sentiment  |
| Decision Engine      | LLM produces structured trade decisions | Autonomous agent with tools          |
| Risk/Collateral Gate | Validates proposed allocations          | Balance checks, slippage limits      |
| Execution Layer      | Submits transactions                    | Aerodrome Router swaps               |
| Reconciliation       | Tracks pending txs, confirms fills      | Wait for receipts, update balances   |
| Observability        | Logging and monitoring                  | Trading diary, metrics               |

---

## Part 2: Data Sources

### 2.1 Price and Market Data

**Primary Options:**

| Provider         | Data Available                                | API Type | Notes         |
| ---------------- | --------------------------------------------- | -------- | ------------- |
| **DexScreener**  | Token prices, charts, pair data               | REST     | Used in agent |
| **CoinGecko**    | OHLCV (daily/hourly/minutely) for Base tokens | REST     | Tiered limits |
| **GoldRush**     | OHLCV + streaming WebSocket                   | REST+WS  | Generous      |
| **Bitquery**     | GraphQL for Aerodrome-specific trade data     | GraphQL  | Tiered        |

**Implementation Pattern:**

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
  async getCandles(tokenAddress: string, interval: string): Promise<CandleData[]>
  calculateEMA(prices: number[], period: number): number | null
  calculateRSI(prices: number[], period: number): number | null
  calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number }
  calculateVWAP(candles: CandleData[], lookback: number): number | null
}
```

### 2.2 DEX-Specific Data (Liquidity, Pools, Quotes)

**Aerodrome Data Sources:**

| Source                   | What It Provides                          | How to Access         |
| ------------------------ | ----------------------------------------- | --------------------- |
| **Direct Contract Calls**| `getAmountsOut()`, pool reserves          | ethers.js             |
| **Bitquery Aerodrome API** | Real-time DEX trades, liquidity metrics | GraphQL               |
| **Expand.network**       | Price quotes, liquidity queries, routing  | REST                  |

**Key Metrics:**

```typescript
interface PoolMetrics {
  reserve0: bigint
  reserve1: bigint
  totalLiquidity: number // USD value
  priceImpact1ETH: number
  volume24h: number
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

### 2.3 Sentiment Data (Social)

**Primary Options:**

| Source                       | What It Provides                             | Best For                |
| ---------------------------- | -------------------------------------------- | ----------------------- |
| **Grok API (X Live Search)** | Real-time X/Twitter sentiment with citations | Asset-specific sentiment |
| **LunarCrush**               | Social engagement metrics                    | Aggregated scores       |
| **Santiment**                | Social volume, dev activity                  | On-chain correlation    |

**Sentiment Data Structure:**

```typescript
interface SentimentObservations {
  observations: {
    [asset: string]: {
      post_themes: string[]
      sentiment_words: string[]
      volume_metrics: {
        current_posts_per_hour: number
        avg_posts_per_hour_baseline: number
        volume_ratio: number
        spike_detected: boolean
        unusual_activity_description: string
      }
      sentiment_velocity: {
        '15min_sentiment_shift': string
        '1hr_sentiment_shift': string
        momentum_description: string
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
      price_expectations: string[]
    }
  }
  citations: string[]
  search_metadata: {
    posts_analyzed: number
    time_windows_checked: string
    data_freshness: string
  }
}
```

### 2.4 On-Chain Data (Gas)

**Gas Price APIs:**

| Provider                  | Features                                          |
| ------------------------- | ------------------------------------------------- |
| **Blocknative Gas API**   | Confidence intervals, block inclusion probability |
| **Infura Gas API**        | EIP-1559 suggestions, dynamic fees                |
| **BaseScan Gas Tracker**  | Simple current fees                               |
| `eth_gasPrice` RPC        | Direct call                                       |

---

## Part 3: Context Building for LLM

### 3.1 Context Payload Structure

```typescript
interface AgentContext {
  invocation: {
    minutes_since_start: number
    current_time: string
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
  }

  market_data: Array<{
    asset: string
    token_address: string
    current_price: number
    change_24h_percent: number

    dex_metrics: {
      pool_liquidity_usd: number
      volume_24h: number
      price_impact_1eth: number
      pool_type: 'stable' | 'volatile'
    }

    recent_price_history: Array<{ t: string; price: number }>
  }>

  x_observations: SentimentObservations | { note: string }

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

The system prompt includes:

1. **Agent Identity and Mission**
2. **Available Tools**
3. **Metric Glossary** (explain each field)
4. **Output Contract** (strict JSON schema)

```typescript
const systemPrompt = `
You are an autonomous crypto trading agent managing a live portfolio on Aerodrome DEX (Base chain).
Mission: Maximize returns through intelligent spot trading.

You will receive market + account context for SEVERAL assets, including:
- assets = ${JSON.stringify(assets)}
- per-asset technical indicators
- DEX-specific metrics (liquidity, volume, price impact)
- Current portfolio holdings
- Recent trading history
- X/Twitter observations (when available)
- Gas prices and network conditions

Trading Actions:
- BUY: Swap ETH or stablecoins for a token. Requires allocation_usd >= $10.
- SELL: Swap a token back to ETH or stablecoins.
- HOLD: Maintain current position.

Key Spot Trading Considerations:
- Price impact: Large orders move price against you. Check dex_metrics.price_impact_1eth.
- Gas costs: Factor in ~$0.01-0.10 per swap. Don't trade if gas > expected profit.
- Liquidity: Low liquidity pools have high slippage. Check pool_liquidity_usd.

Market Metrics Glossary:
• ema_separation_ratio: Distance between EMA20 and EMA50 (positive = 20 above 50)
• price_velocity_5: Rate of price change over 5 periods
• volatility_ratio: Current range vs average (>1 = expanding volatility)
• rsi_distance_from_50: How far RSI is from neutral
• volume_ratio_20: Current volume vs 20-period average

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
      "allocation_usd": 0,
      "rationale": "brief reason for this specific decision"
    }
  ]
}
`
```

### 3.3 Decision Output Schema

```typescript
interface TradeDecision {
  asset: string
  action: 'buy' | 'sell' | 'hold'
  allocation_usd: number
  rationale: string
}

interface AgentOutput {
  reasoning: string
  trade_decisions: TradeDecision[]
}
```

---

## Part 4: Aerodrome Contract Integration

### Contract Addresses (Base Chain)

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| Router V2        | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |
| Universal Router | `0x6Cb442acF35158D5eDa88fe602221b67B400bE3E` |
| Pool Factory     | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` |
| Voter            | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` |
| WETH             | `0x4200000000000000000000000000000000000006` |

### Route Struct

Aerodrome uses a `Route` struct to define swap paths:

```solidity
struct Route {
    address from;      // Input token address
    address to;        // Output token address
    bool stable;       // true for stable pools, false for volatile pools
    address factory;   // Pool factory address (optional, can be address(0))
}
```

Set `stable: true` for stablecoin pairs (USDC/USDT) and `stable: false` for volatile pairs (ETH/USDC).

### Core Swap Functions

#### ERC20 to ERC20

```solidity
function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external returns (uint[] memory amounts);
```

#### Native ETH to ERC20

```solidity
function swapExactETHForTokens(
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external payable returns (uint[] memory amounts);
```

#### ERC20 to Native ETH

```solidity
function swapExactTokensForETH(
    uint amountIn,
    uint amountOutMin,
    Route[] calldata routes,
    address to,
    uint deadline
) external returns (uint[] memory amounts);
```

#### Get Quote

```solidity
function getAmountsOut(
    uint amountIn,
    Route[] calldata routes
) external view returns (uint[] memory amounts);
```

### Implementation with ethers.js

#### Setup

```typescript
import { ethers } from 'ethers'

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'
const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const provider = new ethers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/YOUR_KEY')
const wallet = new ethers.Wallet(privateKey, provider)
```

#### Router ABI (Minimal)

```typescript
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function poolFor(address tokenA, address tokenB, bool stable, address _factory) view returns (address pool)',
]
```

#### Approve Token Spending

```typescript
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

async function approveToken(tokenAddress: string, amount: bigint): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)

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

#### Get Quote

```typescript
async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  stable: boolean = false
): Promise<bigint> {
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, provider)

  const route = [{
    from: tokenIn,
    to: tokenOut,
    stable: stable,
    factory: ethers.ZeroAddress,
  }]

  const amounts = await router.getAmountsOut(amountIn, route)
  return amounts[amounts.length - 1]
}
```

#### Execute Swap

```typescript
async function swapTokensForTokens(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippagePercent: number = 0.5,
  stable: boolean = false
): Promise<string> {
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, wallet)

  const expectedOut = await getQuote(tokenIn, tokenOut, amountIn, stable)
  const minOut = (expectedOut * BigInt(Math.floor((100 - slippagePercent) * 100))) / 10000n

  const route = [{
    from: tokenIn,
    to: tokenOut,
    stable: stable,
    factory: ethers.ZeroAddress,
  }]

  const deadline = Math.floor(Date.now() / 1000) + 1800 // 30 minutes

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

---

## Part 5: Best Practices

### 1. Private Key Security

```typescript
// NEVER hardcode private keys
// Use environment variables or secure key management
const privateKey = process.env.AGENT_PRIVATE_KEY
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

      if (error.code === 'ACTION_REJECTED' || error.code === 'NONCE_EXPIRED') {
        throw error
      }

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

// Base uses EIP-1559
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

## Part 6: Multi-Hop Swaps

For tokens without direct pools, use multiple routes:

```typescript
// ETH -> USDC -> AERO (example)
const routes = [
  { from: WETH, to: USDC, stable: false, factory: ethers.ZeroAddress },
  { from: USDC, to: AERO, stable: false, factory: ethers.ZeroAddress },
]
```

---

## Part 7: Stable vs Volatile Pools

| Pool Type | Use Case                                    | `stable` Value |
| --------- | ------------------------------------------- | -------------- |
| Volatile  | ETH/USDC, token pairs with price volatility | `false`        |
| Stable    | USDC/USDT, pegged assets                    | `true`         |

Stable pools use a different bonding curve optimized for assets that should trade 1:1.

---

## Part 8: Error Handling

Common errors and solutions:

| Error                        | Cause                              | Solution                                 |
| ---------------------------- | ---------------------------------- | ---------------------------------------- |
| `INSUFFICIENT_OUTPUT_AMOUNT` | Slippage exceeded                  | Increase slippage or retry               |
| `EXPIRED`                    | Deadline passed                    | Use longer deadline or retry immediately |
| `INSUFFICIENT_LIQUIDITY`     | Pool doesn't have enough liquidity | Use different route or smaller amount    |
| `TRANSFER_FROM_FAILED`       | Token approval insufficient        | Re-approve with higher amount            |

---

## Quick Reference

### Common Token Addresses (Base)

| Token           | Address                                      |
| --------------- | -------------------------------------------- |
| WETH            | `0x4200000000000000000000000000000000000006` |
| USDC            | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDbC (bridged) | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` |
| AERO            | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` |
| cbETH           | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` |
| DAI             | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` |

### API Key Requirements

```bash
# .env file
# Required
AGENT_PRIVATE_KEY=         # Wallet for trading
BASE_RPC_URL=              # Base RPC (Alchemy recommended)
ANTHROPIC_API_KEY=         # Claude for agent

# Sentiment (optional)
GROK_API_KEY=              # X/Twitter sentiment via Grok
```

### API Endpoints

| Service        | Endpoint                                                         |
| -------------- | ---------------------------------------------------------------- |
| DexScreener    | `https://api.dexscreener.com/tokens/v1/base/{address}`           |
| CoinGecko Base | `https://api.coingecko.com/api/v3/coins/base/contract/{address}` |
| GoldRush       | `https://api.covalenthq.com/v1/base-mainnet/`                    |
| Bitquery       | `https://graphql.bitquery.io/`                                   |

---

## References

- [Aerodrome Contracts GitHub](https://github.com/aerodrome-finance/contracts)
- [BaseScan Router Contract](https://basescan.org/address/0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43)
- [Bitquery Aerodrome API Docs](https://docs.bitquery.io/docs/blockchain/Base/aerodrome-base-api/)
- [CoinGecko Base API](https://www.coingecko.com/en/api/base)
- [GoldRush Base API](https://goldrush.dev/chains/base/)
