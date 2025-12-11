/**
 * Verifies qwen can produce a BUY decision using the same prompt format as callQwenForDecision.
 */
import 'dotenv/config'

import { describe, expect, it } from 'vitest'

const hasAuth = !!(process.env.EIGENAI_API_KEY || process.env.EIGENAI_PRIVATE_KEY)

// Same prompt structure as callQwenForDecision in eigenai.ts
const DECISION_PROMPT = `Based on the following market data gathered from various tools, make a trading decision.

## Original Request
Buy some AERO token

## Tools Called
- getTokenPrice({"token":"AERO"})
- getIndicators({"token":"AERO"})
- getWalletBalance({})

## Gathered Data (3 results)
AERO price: $0.65, 24h change: -18.5%, down from $0.95 weekly high. Major dip on high volume.

---

RSI14: 22 (OVERSOLD - strong buy signal), EMA20: $0.82 (price well below average), MACD: bullish crossover forming, Volume: 3x average (accumulation)

---

Wallet: 500 USDC available, 0 AERO position. Perfect opportunity to enter.

## Your Task
Analyze this data and provide a JSON trading decision in the following format:
{
  "reasoning": "Your analysis of the market data...",
  "trade_decisions": [
    {
      "token": "TOKEN_SYMBOL",
      "action": "BUY" | "SELL" | "HOLD",
      "amount_usd": number,
      "rationale": "Why this specific action..."
    }
  ]
}

If no clear opportunity exists, use action "HOLD" for all positions.
Respond ONLY with the JSON object, no additional text.`

describe.skipIf(!hasAuth)('EigenAI: Qwen can BUY', () => {
  it('produces a BUY action with real prompt format', async () => {
    const response = await fetch(
      process.env.EIGENAI_API_KEY
        ? 'https://eigenai.eigencloud.xyz/v1/chat/completions'
        : 'https://determinal-api.eigenarcade.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EIGENAI_API_KEY && { 'X-API-Key': process.env.EIGENAI_API_KEY }),
        },
        body: JSON.stringify({
          model: 'qwen3-32b-128k-bf16',
          messages: [{ role: 'user', content: DECISION_PROMPT }],
          max_tokens: 1024,
        }),
      }
    )

    interface QwenResponse {
      choices: Array<{ message: { content: string } }>
    }
    const data = (await response.json()) as QwenResponse
    const content = data.choices?.[0]?.message?.content ?? ''

    console.log('Qwen response:', content)

    expect(content.toLowerCase()).toContain('"action"')
    expect(content.toLowerCase()).toContain('buy')
  }, 30000)
})
