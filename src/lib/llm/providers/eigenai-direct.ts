/**
 * EigenAI Direct API Module
 *
 * Provides a direct interface to call Qwen for trading decisions,
 * bypassing the gpt-oss tool-calling model entirely.
 *
 * This is used by the deterministic EigenAI flow where tools are
 * called programmatically, and only Qwen is used for reasoning.
 *
 * Handles:
 * - API authentication (API key)
 * - Building properly formatted prompts
 * - Parsing Qwen's JSON response
 * - Saving verification data for Recall submission
 */
import { eigenaiInferenceTracker } from '../../../services/eigen/eigenai-inference.service.js'
import { getEigenAIApiUrl } from '../types.js'
import type {
  EigenAIChatCompletionResponse,
  EigenAIVerificationData,
  QwenTradeDecision,
} from '../types.js'

/** The Qwen model used for reasoning */
const REASONING_MODEL = 'qwen3-32b-128k-bf16'

/**
 * Create a default HOLD decision for error scenarios.
 */
function createHoldDecision(reason: string): QwenTradeDecision {
  return {
    reasoning: reason,
    trade_decisions: [
      {
        token: 'ALL',
        action: 'HOLD',
        amount_usd: 0,
        via: null,
        rationale: reason,
      },
    ],
  }
}

/**
 * Call Qwen directly with a pre-built prompt.
 *
 * This bypasses gpt-oss entirely and only uses Qwen for reasoning.
 * Verification data is automatically saved to the database for Recall submission.
 *
 * @param systemPrompt - The system prompt to set context
 * @param userPrompt - The user prompt with all gathered data
 * @returns The raw Qwen response content and optional signature
 */
export async function callQwenDirect(
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; signature?: string }> {
  const apiKey = process.env.EIGENAI_API_KEY
  const apiUrl = getEigenAIApiUrl(true) // true = API key auth

  if (!apiKey) {
    console.error('[EigenAI-Direct] No API key configured')
    return {
      content: JSON.stringify(createHoldDecision('EigenAI API key not configured')),
    }
  }

  const endpoint = `${apiUrl}/v1/chat/completions`

  const messages = [
    {
      role: 'system',
      content:
        systemPrompt +
        '\n\nYou are now in DECISION MODE. Based on the gathered data, make your final trading decision.',
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ]

  console.log('[EigenAI-Direct] Calling Qwen for decision...')
  console.log(`  System prompt: ${systemPrompt.length} chars`)
  console.log(`  User prompt: ${userPrompt.length} chars`)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        messages,
        model: REASONING_MODEL,
        max_tokens: 8192,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('[EigenAI-Direct] Qwen call failed:', response.status, errorBody)
      return {
        content: JSON.stringify(createHoldDecision(`Qwen API error: ${response.status}`)),
      }
    }

    const data = (await response.json()) as EigenAIChatCompletionResponse
    const content = data.choices?.[0]?.message?.content ?? ''

    console.log('[EigenAI-Direct] Qwen response received')
    console.log(`  Content length: ${content.length} chars`)
    console.log(`  Signature: ${data.signature ? 'YES' : 'NO'}`)

    // Save verification data for Recall submission
    if (data.signature) {
      // Reconstruct fullPrompt as ALL message contents concatenated
      // EigenAI signs: ChainID + ModelID + FullPrompt + FullOutput
      const fullPrompt = messages.map((m) => m.content || '').join('')

      const verificationData: EigenAIVerificationData = {
        requestPrompt: fullPrompt,
        responseModel: data.model || REASONING_MODEL,
        responseOutput: content,
        signature: data.signature,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      }

      console.log('[EigenAI-Direct] Saving verification data for Recall submission')
      try {
        await eigenaiInferenceTracker.saveInference(verificationData)
      } catch (err) {
        console.error('[EigenAI-Direct] Failed to save verification data:', err)
        // Don't throw - inference tracking failure shouldn't break trading
      }
    }

    return {
      content,
      signature: data.signature,
    }
  } catch (error) {
    console.error('[EigenAI-Direct] Network error:', error)
    return {
      content: JSON.stringify(createHoldDecision('Network error calling Qwen')),
    }
  }
}

/**
 * Parse Qwen's JSON response into a structured decision.
 *
 * Handles various response formats including:
 * - Raw JSON
 * - JSON with <think> tags (extracts JSON after tags)
 * - Malformed responses (returns HOLD)
 */
export function parseQwenDecision(content: string): QwenTradeDecision {
  try {
    // Try to extract JSON from the response
    // Qwen sometimes includes <think> tags before JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[EigenAI-Direct] No JSON found in Qwen response')
      return createHoldDecision('Could not parse decision - no JSON found')
    }

    const parsed = JSON.parse(jsonMatch[0]) as QwenTradeDecision

    // Validate structure
    if (!parsed.trade_decisions || !Array.isArray(parsed.trade_decisions)) {
      console.warn('[EigenAI-Direct] Invalid decision structure')
      return {
        reasoning: parsed.reasoning || 'Invalid structure',
        trade_decisions: [
          {
            token: 'ALL',
            action: 'HOLD',
            amount_usd: 0,
            via: null,
            rationale: 'Invalid structure - holding for safety',
          },
        ],
      }
    }

    return parsed
  } catch (error) {
    console.error('[EigenAI-Direct] JSON parse error:', error)
    return createHoldDecision('JSON parse error')
  }
}
