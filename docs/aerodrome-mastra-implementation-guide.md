# Aerodrome Trading Agent: Mastra Implementation Guide

## Overview

This document explains how to build an autonomous trading agent for Aerodrome DEX using Mastra.ai **correctly**.

The `mastra-predictions` project used Mastra **incorrectly** — it was too prescriptive and didn't give the agent autonomy to decide its own tool calling. This document explains what went wrong and the correct agentic pattern.

---

## 🚨 CRITICAL: What Went Wrong in mastra-predictions

### The Anti-Pattern (What You Built)

Your existing code treats the LLM as a **function** rather than an **autonomous agent**:

```typescript
// ❌ WRONG: autonomous-trading.workflow.ts manually orchestrates tool calls
async function executeAutonomousTradingPipeline(input) {
  // Step 1: Manually filter markets
  const filterResult = applyMarketFilters(input)

  // Step 2: Manually call each tool in sequence
  const newsResult = await callNewsIntelligence(input.marketTitle, input.keywords)
  const twitterResult = await callTwitterIntelligence(input.marketTitle, input.keywords)
  const redditResult = await callRedditIntelligence(
    input.marketTitle,
    input.marketId,
    input.keywords
  )
  const marketResult = await callMarketIntelligence(input.marketId)

  // Step 3: Bundle everything and make ONE LLM call
  const aiDecision = await makeAutonomousDecision(marketTitle, intelligenceBundle)

  // Step 4: Execute...
}
```

**Problems:**

1. **No agent autonomy** — The workflow dictates exactly which tools to call and in what order
2. **LLM can't iterate** — It gets ONE chance to make a decision, no "let me check more data"
3. **Agents defined but never used** — `researchAgent` has tools but the workflow bypasses them entirely
4. **Single LLM call via `generateText()`** — Not agentic at all, just a fancy prompt

### The Correct Pattern (What You Should Build)

Mastra agents are designed to **iterate internally** until they have enough information:

```typescript
// ✅ CORRECT: Let the agent decide which tools to call
export const tradingAgent = new Agent({
  name: 'aerodrome-trading-agent',
  instructions: `
    You are an autonomous trading agent for Aerodrome DEX on Base chain.
    
    You have access to tools for:
    - Getting token prices and market data
    - Checking pool liquidity and price impact
    - Analyzing Twitter/X sentiment
    - Reading news about tokens
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
  model: anthropic('claude-sonnet-4-20250514'),
  tools: {
    getTokenPrice,
    getPoolMetrics,
    getTwitterSentiment,
    getNewsSentiment,
    getAerodromeQuote,
    executeSwap,
  },
})

// Usage: Let the agent iterate with maxSteps
const response = await tradingAgent.generate(
  `Analyze AERO/USDC on Aerodrome and decide if I should buy, sell, or hold. 
   I have $500 USDC available. Current AERO price is ~$1.20.`,
  {
    maxSteps: 15, // Allow up to 15 tool-calling iterations
    onStepFinish: ({ toolCalls, toolResults }) => {
      console.log(
        'Agent called:',
        toolCalls?.map((t) => t.toolName)
      )
    },
  }
)

console.log(response.text) // Agent's final decision with reasoning
```

### Key Differences

| Aspect                    | ❌ mastra-predictions                  | ✅ Correct Pattern                   |
| ------------------------- | -------------------------------------- | ------------------------------------ |
| **Tool calling**          | Workflow manually calls each tool      | Agent decides which tools to call    |
| **Iteration**             | Single LLM call via `generateText()`   | Agent iterates via `maxSteps`        |
| **Autonomy**              | LLM is a "function" that receives data | LLM reasons about what data it needs |
| **Information gathering** | Prescribed sequence                    | Agent-driven until confident         |
| **Stopping condition**    | Workflow completes all steps           | Agent decides it has enough info     |

### The Agentic Loop (How Mastra Actually Works)

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
│  5. LLM evaluates: "Good sentiment, but let me check news"  │
│                    ↓                                        │
│  6. LLM calls: getNewsSentiment({ query: "AERO Aerodrome"}) │
│                    ↓                                        │
│  7. Tool returns: { sentiment: 0.5, breaking_news: false }  │
│                    ↓                                        │
│  8. LLM evaluates: "Mixed signals. Check pool liquidity."   │
│                    ↓                                        │
│  9. LLM calls: getPoolMetrics({ pair: "AERO/USDC" })        │
│                    ↓                                        │
│  10. Tool returns: { liquidity: 2.5M, priceImpact1k: 0.1% } │
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

- **TypeScript-native** - No polyglot complexity
- **Tool composability** - `createTool()` pattern for DEX interactions
- **Agentic by design** - `maxSteps` for autonomous iteration
- **Vercel AI SDK integration** - LLM provider flexibility
- **Low learning curve** - Hours to MVP

---

## Recommended Architecture

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
│   │   │   ├── indicators.tool.ts # OHLCV + technicals
│   │   │   └── gas.tool.ts        # Gas estimation
│   │   └── sentiment/
│   │       ├── grok.tool.ts       # X/Twitter via Grok
│   │       └── news.tool.ts       # News aggregation
│   │
│   ├── workflows/
│   │   └── trading-loop.workflow.ts  # Main agent loop
│   │
│   ├── execution/
│   │   ├── wallet.ts              # ethers.js wallet management
│   │   ├── router.ts              # Aerodrome Router interface
│   │   └── retry.ts               # Transaction retry logic
│   │
│   ├── database/
│   │   ├── schema/
│   │   │   ├── trades.ts          # Trade history
│   │   │   ├── decisions.ts       # Decision audit log
│   │   │   └── snapshots.ts       # Portfolio snapshots
│   │   └── repositories/
│   │
│   └── config/
│       ├── assets.ts              # Tradeable tokens
│       ├── strategies.ts          # Strategy parameters
│       └── risk.ts                # Risk limits
│
├── drizzle/                       # Database migrations
├── .env                           # API keys, RPC URLs
└── package.json
```

---

## Correct Implementation Plan

### Phase 1: Tools First (Days 1-3)

Build small, focused tools that the agent can compose:

```typescript
// src/tools/aerodrome/quote.tool.ts
export const getQuoteTool = createTool({
  id: 'aerodrome-get-quote',
  description: 'Get a swap quote from Aerodrome. Returns expected output amount and price impact.',
  inputSchema: z.object({
    tokenIn: z.string().describe('Input token symbol or address'),
    tokenOut: z.string().describe('Output token symbol or address'),
    amountIn: z.string().describe('Amount to swap in human-readable format'),
  }),
  outputSchema: z.object({
    amountOut: z.string(),
    priceImpact: z.number(),
    route: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    // Call Aerodrome Router getAmountsOut()
  },
})

// src/tools/aerodrome/pool.tool.ts
export const getPoolMetricsTool = createTool({
  id: 'aerodrome-pool-metrics',
  description: 'Get liquidity pool metrics including TVL, volume, and fee tier.',
  inputSchema: z.object({
    tokenA: z.string(),
    tokenB: z.string(),
  }),
  outputSchema: z.object({
    tvl: z.number(),
    volume24h: z.number(),
    fee: z.number(),
    isStable: z.boolean(),
  }),
  execute: async ({ context }) => {
    // Query pool data
  },
})

// src/tools/sentiment/twitter.tool.ts
export const getTwitterSentimentTool = createTool({
  id: 'twitter-sentiment',
  description:
    'Analyze Twitter/X sentiment for a token or topic. Returns sentiment score and key themes.',
  inputSchema: z.object({
    query: z.string().describe('Search query (token name, hashtag, or topic)'),
    timeframe: z.enum(['1h', '4h', '24h']).default('4h'),
  }),
  outputSchema: z.object({
    sentimentScore: z.number().min(-1).max(1),
    confidence: z.number().min(0).max(1),
    themes: z.array(z.string()),
    postCount: z.number(),
  }),
  execute: async ({ context }) => {
    // Use Grok API or scraper
  },
})

// src/tools/aerodrome/swap.tool.ts
export const executeSwapTool = createTool({
  id: 'aerodrome-execute-swap',
  description: "Execute a token swap on Aerodrome. Only call this when you've decided to trade.",
  inputSchema: z.object({
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string(),
    minAmountOut: z.string(),
    slippagePercent: z.number().default(0.5),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    txHash: z.string().optional(),
    amountOut: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    // Execute via ethers.js
  },
})
```

### Phase 2: Single Autonomous Agent (Days 4-5)

Create ONE agent with ALL tools, empowered to decide:

```typescript
// src/agents/trading.agent.ts
import { anthropic } from '@ai-sdk/anthropic'
import { Agent } from '@mastra/core/agent'

import { executeSwapTool, getPoolMetricsTool, getQuoteTool } from '../tools/aerodrome'
import { getIndicatorsTool, getTokenPriceTool } from '../tools/market'
import { getNewsSentimentTool, getTwitterSentimentTool } from '../tools/sentiment'

export const aerodromeAgent = new Agent({
  name: 'aerodrome-trader',
  instructions: `
You are an autonomous trading agent for Aerodrome DEX on Base chain.

## Your Tools
You have tools for:
- **getQuote**: Get swap quotes and price impact from Aerodrome
- **getPoolMetrics**: Check liquidity, volume, and pool health
- **getTwitterSentiment**: Analyze social sentiment on X/Twitter
- **getNewsSentiment**: Check crypto news sentiment
- **getTokenPrice**: Get current token prices
- **getIndicators**: Get technical indicators (RSI, EMA, MACD)
- **executeSwap**: Execute a trade (only when ready)

## How to Operate
1. When given a trading task, YOU decide which tools to call
2. Gather information iteratively until you're confident
3. If signals conflict, dig deeper - check more sources
4. Consider: sentiment, technicals, liquidity, price impact
5. Only recommend trades with 70%+ confidence

## Key Metrics for Spot DEX Trading
- **Price Impact**: Must be < 1% for large trades
- **Liquidity**: TVL should be > $100k for the pair
- **Sentiment**: Look for convergence across Twitter + news
- **Technicals**: RSI < 30 = oversold, RSI > 70 = overbought

## Risk Rules
- Never trade > 10% of available balance in one trade
- Always check price impact before executing
- If liquidity is low, reduce position size
- If sentiment is mixed, consider holding

## Output Format
When you've gathered enough information, provide:
1. Your recommendation: BUY / SELL / HOLD
2. Confidence level (0-100%)
3. Position size recommendation
4. Key factors that drove your decision
5. Risk factors to monitor

You are autonomous. Don't wait to be told which tools to use.
  `,
  model: anthropic('claude-sonnet-4-20250514'),
  tools: {
    getQuote: getQuoteTool,
    getPoolMetrics: getPoolMetricsTool,
    getTwitterSentiment: getTwitterSentimentTool,
    getNewsSentiment: getNewsSentimentTool,
    getTokenPrice: getTokenPriceTool,
    getIndicators: getIndicatorsTool,
    executeSwap: executeSwapTool,
  },
})
```

### Phase 3: Simple Loop (Days 6-7)

The "workflow" is now trivially simple - just call the agent:

```typescript
// src/loop/trading-loop.ts
import { aerodromeAgent } from '../agents/trading.agent'

interface TradingContext {
  availableBalance: number
  targetToken: string
  baseToken: string
}

export async function runTradingIteration(ctx: TradingContext): Promise<void> {
  console.log(`\n🤖 Starting trading iteration for ${ctx.targetToken}/${ctx.baseToken}`)

  const prompt = `
    Analyze ${ctx.targetToken}/${ctx.baseToken} on Aerodrome DEX.
    I have ${ctx.availableBalance} ${ctx.baseToken} available to trade.
    
    Use your tools to gather market data, check sentiment, and analyze 
    the opportunity. Then tell me if I should BUY, SELL, or HOLD.
  `

  const response = await aerodromeAgent.generate(prompt, {
    maxSteps: 20, // Allow plenty of tool-calling iterations
    onStepFinish: ({ toolCalls, toolResults, text }) => {
      if (toolCalls?.length) {
        console.log(`  📞 Called: ${toolCalls.map((t) => t.toolName).join(', ')}`)
      }
    },
  })

  console.log(`\n📊 Agent Decision:\n${response.text}`)

  // Log to database for audit
  await logDecision({
    timestamp: new Date(),
    prompt,
    response: response.text,
    toolCalls: response.steps?.flatMap((s) => s.toolCalls || []),
  })
}

// Main loop - run every N minutes
async function main() {
  const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

  const watchlist = [
    { targetToken: 'AERO', baseToken: 'USDC' },
    { targetToken: 'WETH', baseToken: 'USDC' },
  ]

  while (true) {
    for (const pair of watchlist) {
      const balance = await getWalletBalance('USDC')
      await runTradingIteration({
        availableBalance: balance,
        targetToken: pair.targetToken,
        baseToken: pair.baseToken,
      })
    }

    console.log(`\n⏳ Sleeping ${INTERVAL_MS / 60000} minutes...`)
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}
```

### Phase 4: Testing & Refinement (Week 2)

1. **Paper trading mode**: Have `executeSwap` tool log instead of executing
2. **Prompt iteration**: Refine agent instructions based on observed behavior
3. **Tool refinement**: Add/remove tools based on what agent actually uses
4. **Structured output**: Add Zod schema for final decisions if needed

---

## What to Keep vs Discard from mastra-predictions

### ✅ KEEP (Reusable Patterns)

| Component                         | Why Keep                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| Tool definitions (`createTool()`) | Same pattern, just give to agent instead of calling directly |
| Database schema/repos             | Audit logging is still valuable                              |
| Error handling in tools           | Robust tool execution                                        |
| API integrations (Twitter, news)  | Just wrap them as tools                                      |

### ❌ DISCARD (Anti-Patterns)

| Component                         | Why Discard                                |
| --------------------------------- | ------------------------------------------ |
| `autonomous-trading.workflow.ts`  | Manual orchestration is the anti-pattern   |
| `callNewsIntelligence()` wrappers | Don't manually call tools                  |
| `makeAutonomousDecision()`        | Single `generateText()` call isn't agentic |
| Multi-factor scoring functions    | Let the LLM reason about this              |
| Prescribed step sequence          | Agent should decide the sequence           |

---

## Correct Tool Design Principles

### 1. Tools Should Be Small and Focused

```typescript
// ❌ WRONG: One giant tool that does everything
const analyzeMarketTool = createTool({
  id: 'analyze-market',
  description: 'Analyzes market and returns trading decision',
  // This takes away agent autonomy!
})

// ✅ CORRECT: Small tools the agent can compose
const getPriceTool = createTool({
  /* ... */
})
const getSentimentTool = createTool({
  /* ... */
})
const getPoolMetricsTool = createTool({
  /* ... */
})
```

### 2. Tool Descriptions Are Critical

The LLM uses descriptions to decide WHEN to call a tool:

```typescript
// ❌ WRONG: Vague description
description: 'Gets Twitter data'

// ✅ CORRECT: Clear description of what it does and when to use it
description: 'Analyze Twitter/X sentiment for a token or topic. Use this when you need to gauge social sentiment or detect breaking news about a token.'
```

### 3. Let Tools Be "Read" Operations (Mostly)

Most tools should gather information. Only a few should take action:

```typescript
// Read operations (call freely)
;(-getQuote,
  getPoolMetrics,
  getSentiment,
  getPrice,
  getIndicators -
    // Write operations (call with caution)
    executeSwap,
  approveToken)
```

The agent instructions should emphasize gathering enough info before calling write tools

---

## Key Mastra Features for Agentic Trading

### `maxSteps` - Allow Agent Iteration

```typescript
const response = await agent.generate(prompt, {
  maxSteps: 20, // Agent can make up to 20 tool calls
})
```

### `onStepFinish` - Observe Agent Reasoning

```typescript
const response = await agent.generate(prompt, {
  maxSteps: 20,
  onStepFinish: ({ toolCalls, toolResults, text, finishReason }) => {
    console.log(
      'Tools called:',
      toolCalls?.map((t) => t.toolName)
    )
    console.log('Finish reason:', finishReason) // "tool-calls" or "stop"
  },
})
```

### Structured Output - Type-Safe Decisions

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

## Summary: The Right Way to Build with Mastra

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
- [ ] Keep the loop simple - just call the agent
