# Aerodrome Trading Agent: Mastra Implementation Guide

## Overview

This document explains the architecture and implementation of an autonomous trading agent for Aerodrome DEX using the Mastra.ai framework. The agent operates on Base chain and makes its own decisions about which tools to call and when.

---

## Core Pattern: Autonomous Agent

Mastra agents are designed to **iterate internally** until they have enough information:

```typescript
// Let the agent decide which tools to call
export const tradingAgent = new Agent({
  name: 'aerodrome-trading-agent',
  instructions: `
    You are an autonomous trading agent for Aerodrome DEX on Base chain.
    
    You have access to tools for:
    - Getting token prices and market data
    - Checking pool liquidity and price impact
    - Analyzing Twitter/X sentiment
    - Getting quotes from Aerodrome
    - Executing swaps
    
    When given a trading task:
    1. Use your tools to gather the information YOU think is necessary
    2. Call tools iteratively until you have enough confidence
    3. If sentiment is unclear, check more sources
    4. If liquidity seems low, verify with pool metrics
    5. Only recommend a trade when you have 70%+ confidence
    
    You decide what data you need - don't wait to be told.
  `,
  model: anthropic('claude-sonnet-4-5'),
  tools: {
    getTokenPrice,
    getPoolMetrics,
    getTwitterSentiment,
    getAerodromeQuote,
    executeSwap,
  },
})

// Usage: Let the agent iterate with maxSteps
const response = await tradingAgent.generate(
  `Analyze AERO/USDC on Aerodrome and decide if I should buy, sell, or hold.`,
  {
    maxSteps: 15, // Allow up to 15 tool-calling iterations
    onStepFinish: ({ toolCalls }) => {
      console.log('Agent called:', toolCalls?.map((t) => t.toolName))
    },
  }
)

console.log(response.text) // Agent's final decision with reasoning
```

### Key Principles

| Aspect                    | How It Works                             |
| ------------------------- | ---------------------------------------- |
| **Tool calling**          | Agent decides which tools to call        |
| **Iteration**             | Agent iterates via `maxSteps`            |
| **Autonomy**              | LLM reasons about what data it needs     |
| **Information gathering** | Agent-driven until confident             |
| **Stopping condition**    | Agent decides it has enough info         |

### The Agentic Loop

When you call `agent.generate()` with tools:

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTIC LOOP                             │
├─────────────────────────────────────────────────────────────┤
│  1. LLM receives prompt + sees available tools              │
│                    ↓                                        │
│  2. LLM reasons: "I need Twitter sentiment for AERO"        │
│                    ↓                                        │
│  3. LLM calls: getTwitterSentiment({ token: "AERO" })       │
│                    ↓                                        │
│  4. Tool returns: { sentiment: 0.7, confidence: 0.8, ... }  │
│                    ↓                                        │
│  5. LLM evaluates: "Good sentiment, let me check price"     │
│                    ↓                                        │
│  6. LLM calls: getTokenPrice({ token: "AERO" })             │
│                    ↓                                        │
│  7. Tool returns: { price: 0.70, change24h: 5.2% }          │
│                    ↓                                        │
│  8. LLM evaluates: "Price is up. Check pool liquidity."     │
│                    ↓                                        │
│  9. LLM calls: getPoolMetrics({ pair: "AERO/USDC" })        │
│                    ↓                                        │
│  10. Tool returns: { liquidity: 2.5M, priceImpact: 0.1% }   │
│                    ↓                                        │
│  11. LLM decides: "Enough info. 72% confidence. BUY $200."  │
│                    ↓                                        │
│  12. STOP - Agent emits final answer                        │
└─────────────────────────────────────────────────────────────┘
```

This loop continues until:

- The LLM decides it has enough information and provides a final answer
- `maxSteps` limit is reached
- An optional stop condition is met

---

## Why Mastra

- **TypeScript-native** — No polyglot complexity
- **Tool composability** — `createTool()` pattern for DEX interactions
- **Agentic by design** — `maxSteps` for autonomous iteration
- **Vercel AI SDK integration** — LLM provider flexibility
- **Low learning curve** — Hours to MVP

---

## Architecture

```
aerodrome-trading-agent/
├── src/
│   ├── agents/
│   │   └── trading.agent.ts       # Main trading decision agent
│   │
│   ├── tools/
│   │   ├── aerodrome/
│   │   │   ├── swap.tool.ts       # Execute swaps
│   │   │   ├── quote.tool.ts      # Get quotes
│   │   │   └── pool.tool.ts       # Pool metrics
│   │   ├── market/
│   │   │   ├── price.tool.ts      # Token prices via DexScreener
│   │   │   └── balance.tool.ts    # Wallet balances via Alchemy
│   │   └── sentiment/
│   │       └── twitter.tool.ts    # X/Twitter via Grok
│   │
│   ├── loop/
│   │   └── trading-loop.ts        # Main agent loop
│   │
│   ├── execution/
│   │   └── wallet.ts              # ethers.js + Alchemy SDK
│   │
│   ├── database/
│   │   ├── schema/
│   │   │   └── trading/           # Trade diary, snapshots
│   │   └── repositories/
│   │
│   └── config/
│       ├── tokens.ts              # Token addresses
│       └── contracts.ts           # Aerodrome contracts
│
├── drizzle/                       # Database migrations
├── .env                           # API keys, RPC URLs
└── package.json
```

---

## Tool Design Principles

### 1. Tools Should Be Small and Focused

```typescript
// ❌ WRONG: One giant tool that does everything
const analyzeMarketTool = createTool({
  id: 'analyze-market',
  description: 'Analyzes market and returns trading decision',
  // This takes away agent autonomy!
})

// ✅ CORRECT: Small tools the agent can compose
const getPriceTool = createTool({ /* ... */ })
const getSentimentTool = createTool({ /* ... */ })
const getPoolMetricsTool = createTool({ /* ... */ })
```

### 2. Tool Descriptions Are Critical

The LLM uses descriptions to decide WHEN to call a tool:

```typescript
// ❌ WRONG: Vague description
description: 'Gets Twitter data'

// ✅ CORRECT: Clear description of what and when
description: `Analyze Twitter/X sentiment for a token. 
Use this when you need to gauge social sentiment or detect breaking news.`
```

### 3. Tools Return Raw Data

Tools should return raw data, not interpretations. The agent decides what the data means:

```typescript
// ✅ CORRECT: Return raw observations
execute: async ({ context }) => {
  return {
    success: true,
    price: { usd: '0.70', change24hPercent: 5.2 },
    market: { volume24hUsd: 8570000, liquidityUsd: 40240000 },
  }
}
```

### 4. Separate Read and Write Operations

Most tools should gather information. Only a few should take action:

```typescript
// Read operations (call freely)
getQuote
getPoolMetrics
getSentiment
getPrice
getBalance

// Write operations (call with caution)
executeSwap
approveToken
```

---

## Key Mastra Features

### `maxSteps` — Allow Agent Iteration

```typescript
const response = await agent.generate(prompt, {
  maxSteps: 20, // Agent can make up to 20 tool calls
})
```

### `onStepFinish` — Observe Agent Reasoning

```typescript
const response = await agent.generate(prompt, {
  maxSteps: 20,
  onStepFinish: ({ toolCalls, text, finishReason }) => {
    console.log('Tools called:', toolCalls?.map((t) => t.toolName))
    console.log('Finish reason:', finishReason) // "tool-calls" or "stop"
  },
})
```

### Structured Output — Type-Safe Decisions

```typescript
const response = await agent.generate(prompt, {
  maxSteps: 20,
  structuredOutput: {
    schema: z.object({
      action: z.enum(['BUY', 'SELL', 'HOLD']),
      confidence: z.number().min(0).max(100),
      amount: z.number().optional(),
      reasoning: z.string(),
    }),
  },
})

// response.object is typed!
if (response.object.action === 'BUY' && response.object.confidence > 70) {
  // Execute trade
}
```

---

## Trading Loop

The loop is simple — just call the agent:

```typescript
// src/loop/trading-loop.ts
import { aerodromeAgent } from '../agents/trading.agent'

export async function runTradingIteration(ctx: TradingContext): Promise<void> {
  const prompt = `
    Analyze ${ctx.targetToken}/${ctx.baseToken} on Aerodrome DEX.
    
    Recent Trading History:
    ${formatHistoryForAgent(ctx.recentHistory)}
    
    Use your tools to gather data and decide: BUY, SELL, or HOLD.
  `

  const response = await aerodromeAgent.generate(prompt, {
    maxSteps: 15,
    onStepFinish: ({ toolCalls }) => {
      if (toolCalls?.length) {
        console.log(`Called: ${toolCalls.map((t) => t.toolName).join(', ')}`)
      }
    },
  })

  console.log(`Agent Decision:\n${response.text}`)

  // Parse and log to database
  const decision = parseAgentDecision(response.text)
  if (decision) {
    await tradingDiaryRepo.logDecision({ ... })
  }
}

// Main loop
export async function startTradingLoop(): Promise<void> {
  while (true) {
    for (const pair of DEFAULT_TRADING_PAIRS) {
      await runTradingIteration({ ... })
    }
    await sleep(INTERVAL_MS)
  }
}
```

---

## Database Schema

The agent logs all decisions for retrospective analysis:

```typescript
// Trading Diary - Every decision the agent makes
tradingDiary: {
  id: uuid
  iterationNumber: number
  timestamp: timestamp
  tokenPair: string      // "AERO/USDC"
  action: string         // "BUY" | "SELL" | "HOLD"
  amountUsd: decimal
  reasoning: text        // Full agent reasoning
  executed: boolean
  transactionHash: string
  priceAtDecision: decimal
  priceAfter1h: decimal  // For retrospective
  priceAfter4h: decimal
  priceAfter24h: decimal
}

// Swap Transactions - Actual executions
swapTransactions: {
  id: uuid
  diaryId: uuid          // Links to diary entry
  txHash: string
  tokenIn: string
  tokenOut: string
  amountIn: decimal
  amountOut: decimal
  gasUsed: decimal
  status: string
}

// Portfolio Snapshots - Point-in-time state
portfolioSnapshots: {
  id: uuid
  timestamp: timestamp
  totalValueUsd: decimal
  balances: jsonb        // { ETH: "0.5", USDC: "100", ... }
}
```

---

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=...

# Trading (optional - read-only without these)
AGENT_PRIVATE_KEY=0x...
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Sentiment (optional)
GROK_API_KEY=...

# Settings
TRADING_INTERVAL_MINUTES=5
MAX_AGENT_STEPS=15
```

---

## Summary

**Core principles:**

1. ✅ **Tools are composable** — Small, focused tools the agent can combine
2. ✅ **Agent is autonomous** — Use `maxSteps` to let it iterate
3. ✅ **Loop is simple** — Just call `agent.generate()` with a prompt
4. ✅ **Instructions empower** — Tell agent WHAT tools exist, not WHEN to use them
5. ✅ **LLM decides** — Agent chooses which tools, in what order, until confident

**The key insight:**

> Don't build a workflow that calls tools in sequence.
> Build an agent that reasons about which tools it needs.

---

## Quick Start Checklist

- [ ] Create small, focused tools (quote, pool, sentiment, price, swap)
- [ ] Write clear tool descriptions (WHAT it does, WHEN to use it)
- [ ] Build ONE agent with ALL tools
- [ ] Write empowering instructions (not prescriptive)
- [ ] Call `agent.generate()` with `maxSteps: 15-20`
- [ ] Observe with `onStepFinish` to debug agent reasoning
- [ ] Use `structuredOutput` for type-safe decisions
- [ ] Keep the loop simple — just call the agent
