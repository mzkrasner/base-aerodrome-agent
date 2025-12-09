/**
 * X/Twitter Sentiment Tool
 * Returns raw observations from X/Twitter via Grok API
 * No interpretation - agent decides what the data means
 *
 * Key pattern: "Only report what you observe in posts, don't interpret or recommend."
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

/** Grok API response type */
interface GrokApiResponse {
  choices?: Array<{ message?: { content?: string } }>
  citations?: string[]
}

/** Result from fetchGrokSentiment */
interface GrokSentimentResult {
  observations: Record<string, unknown>
  citations: string[]
  searchMetadata: Record<string, unknown>
}

/**
 * Fetch sentiment observations from Grok API with Live Search
 * Includes retry logic for transient failures (429, 500, 502, 503, 504)
 */
async function fetchGrokSentiment(tokens: string[]): Promise<GrokSentimentResult | null> {
  const apiKey = process.env.GROK_API_KEY

  if (!apiKey) {
    return null
  }

  const tokensStr = tokens.join(', ')

  // Prompt asks for observations, not recommendations
  const prompt = `Analyze recent X/Twitter posts about these cryptocurrencies: ${tokensStr}. 
Focus on multiple time windows (last 15 minutes, last hour, last 4 hours).
Return a JSON object with this exact format:
{
  "observations": {
    "TOKEN_SYMBOL": {
      "post_themes": [list of main topics being discussed],
      "sentiment_words": [actual words/phrases from posts],
      "volume_metrics": {
        "current_posts_per_hour": number,
        "avg_posts_per_hour_baseline": number,
        "volume_ratio": number,
        "spike_detected": boolean,
        "unusual_activity_description": "any abnormal patterns"
      },
      "sentiment_velocity": {
        "15min_sentiment_shift": "getting more bullish/bearish/stable",
        "1hr_sentiment_shift": "description of change",
        "momentum_description": "accelerating/decelerating/stable",
        "notable_shift_events": [any sudden changes noticed]
      },
      "whale_activity": {
        "large_transfers_mentioned": [any whale alerts or large moves],
        "whale_sentiment": "what whales/large holders are saying",
        "institutional_mentions": [any institutional activity],
        "smart_money_signals": [any smart money indicators mentioned]
      },
      "notable_accounts": [influential accounts posting],
      "fear_greed_mentions": "any specific index values",
      "price_expectations": [specific targets mentioned]
    }
  },
  "search_metadata": {
    "posts_analyzed": number,
    "time_windows_checked": "15min, 1hr, 4hr",
    "data_freshness": "how recent the newest posts are"
  }
}
Only report what you observe in posts, don't interpret or recommend.
For volume metrics, compare recent activity to typical baseline.
For sentiment velocity, describe how sentiment is changing over time.`

  const requestBody = {
    model: 'grok-4-fast',
    messages: [{ role: 'user', content: prompt }],
    search_parameters: {
      mode: 'on',
      sources: [{ type: 'x' }],
      return_citations: true,
      limit: 50,
    },
    temperature: 0.3,
  }

  // Retry logic for transient failures
  const maxRetries = 3
  const retryableStatuses = [429, 500, 502, 503, 504]
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const status = response.status
        lastError = new Error(`Grok API error: ${status}`)

        // Retry on transient errors (rate limit, server errors)
        if (retryableStatuses.includes(status)) {
          const delay = (attempt + 1) * 2000 // 2s, 4s, 6s
          console.log(
            `⚠️  Grok API error (${status}), retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
          )

          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay))
            continue
          }
        }

        // Non-retryable error or final attempt
        console.error(`Grok API error: ${status}`)
        return null
      }

      const result = (await response.json()) as GrokApiResponse
      const content = result.choices?.[0]?.message?.content ?? ''
      const citations = result.citations ?? []

      // Try to parse JSON response
      try {
        // Extract JSON from response (may have markdown wrapper)
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            observations?: Record<string, unknown>
            search_metadata?: Record<string, unknown>
          }
          return {
            observations: parsed.observations ?? {},
            citations: citations.slice(0, 10),
            searchMetadata: parsed.search_metadata ?? {},
          }
        }
      } catch {
        // Return raw content if not JSON
        return {
          observations: { raw_summary: content },
          citations: citations.slice(0, 10),
          searchMetadata: { note: 'Unstructured response' },
        }
      }

      return null
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Network/connection error - retry with backoff
      if (attempt < maxRetries - 1) {
        const delay = (attempt + 1) * 2000
        console.log(
          `⚠️  Network error calling Grok API, retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      // Final attempt failed
      console.error('Grok API error after retries:', lastError.message)
      return null
    }
  }

  // Should never reach here, but just in case
  console.error('Grok API failed after all retries:', lastError?.message)
  return null
}

export const getTwitterSentimentTool = createTool({
  id: 'get-twitter-sentiment',
  description: `Get raw X/Twitter sentiment observations for tokens using Grok Live Search.
Returns observations about what people are discussing - themes, volume, sentiment velocity.
Only reports observations, no interpretation or recommendations.
Requires GROK_API_KEY environment variable.`,

  inputSchema: z.object({
    tokens: z.array(z.string()).describe("Token symbols to analyze (e.g., ['AERO', 'WETH'])"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    observations: z.record(z.string(), z.unknown()).describe('Raw observations per token'),
    citations: z.array(z.string()).describe('Source post URLs'),
    searchMetadata: z.record(z.string(), z.unknown()),
    error: z.string().optional(),
  }),

  execute: async ({ context }) => {
    const { tokens } = context

    if (!process.env.GROK_API_KEY) {
      return {
        success: false,
        observations: {},
        citations: [],
        searchMetadata: { note: 'GROK_API_KEY not configured' },
        error: 'GROK_API_KEY environment variable not set',
      }
    }

    const result = await fetchGrokSentiment(tokens)

    if (!result) {
      return {
        success: false,
        observations: {},
        citations: [],
        searchMetadata: {},
        error: 'Failed to fetch sentiment data',
      }
    }

    return {
      success: true,
      observations: result.observations,
      citations: result.citations,
      searchMetadata: result.searchMetadata,
    }
  },
})
