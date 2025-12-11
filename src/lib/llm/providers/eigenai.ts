/**
 * EigenAI Provider for Vercel AI SDK
 *
 * Implements LanguageModelV2 interface to enable EigenAI as a drop-in LLM provider.
 * Handles:
 * - Grant message signing (required before each request)
 * - Streaming and non-streaming completions
 * - Verification data capture for signature submission to Recall
 *
 * @see https://mastra.ai/docs
 * @see EigenAI dTERMinal API specification
 */
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { privateKeyToAccount } from 'viem/accounts'

import {
  DEFAULT_MODELS,
  type EigenAIChatCompletionResponse,
  type EigenAIErrorCode,
  type EigenAIGrantResponse,
  type EigenAIStreamChunk,
  type EigenAIVerificationData,
  getEigenAIApiUrl,
} from '../types'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating an EigenAI model
 *
 * Two authentication methods are supported:
 * 1. API Key (simpler) - Set `apiKey` to use X-API-Key header auth
 * 2. Wallet Signing (verifiable) - Set `privateKey` to use grant message signing
 *
 * If both are provided, API key takes precedence.
 */
export interface CreateEigenAIModelOptions {
  /**
   * Model ID to use for inference
   *
   * Note: gpt-oss-120b-f16 is a tool-calling only model (no text output).
   * Trades are executed directly via the executeSwap tool.
   *
   * @default 'gpt-oss-120b-f16'
   */
  modelId?: string
  /**
   * EigenAI API Key for simple authentication
   *
   * When provided, uses X-API-Key header instead of wallet signing.
   * This is simpler but doesn't provide verifiable inference.
   */
  apiKey?: string
  /**
   * Wallet private key for grant signing (hex string starting with 0x)
   *
   * Required if apiKey is not provided. Provides verifiable inference
   * with cryptographic signatures.
   */
  privateKey?: `0x${string}`
  /**
   * EigenAI API URL
   *
   * @default process.env.EIGENAI_API_URL || 'https://eigenai.eigencloud.xyz'
   */
  apiUrl?: string
  /** Optional callback to capture verification data for each inference */
  onVerification?: (data: EigenAIVerificationData) => void | Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse EigenAI error response and return appropriate error code
 */
function parseEigenAIErrorCode(body: Record<string, unknown>): EigenAIErrorCode {
  const error = body.error as Record<string, unknown> | undefined
  const message = (error?.message ?? body.message ?? '') as string
  const code = (error?.code ?? body.code ?? '') as string

  if (code === 'grant_expired' || message.includes('grant expired')) {
    return 'grant_expired'
  }
  if (
    code === 'grant_not_found' ||
    message.includes('no grant') ||
    message.includes('grant not found')
  ) {
    return 'grant_not_found'
  }
  if (code === 'insufficient_tokens' || message.includes('insufficient')) {
    return 'insufficient_tokens'
  }
  if (code === 'invalid_signature' || message.includes('invalid signature')) {
    return 'invalid_signature'
  }
  if (code === 'rate_limited' || message.includes('rate limit')) {
    return 'rate_limited'
  }
  return 'unknown'
}

/**
 * EigenAI message type - supports tool calling per their docs
 * @see https://docs.eigen.xyz/eigenai/use-eigenai
 */
interface EigenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

/**
 * Convert LanguageModelV2 prompt to EigenAI messages format
 *
 * IMPORTANT: Mastra accumulates ALL tool calls into ONE assistant part and ALL
 * tool results into ONE tool part. But OpenAI's format requires each tool call
 * to have its OWN assistant message followed by its result.
 *
 * This function reconstructs the proper turn-by-turn conversation:
 * - assistant: tool_calls: [A] → tool: result_A
 * - assistant: tool_calls: [B] → tool: result_B
 * - etc.
 */
function convertPromptToMessages(prompt: LanguageModelV2CallOptions['prompt']): EigenAIMessage[] {
  const messages: EigenAIMessage[] = []

  // First pass: collect tool calls and results separately
  const toolCalls: Array<{
    id: string
    name: string
    arguments: string
  }> = []
  const toolResults = new Map<string, { toolCallId: string; content: string }>()

  for (const part of prompt) {
    if (part.role === 'system') {
      messages.push({ role: 'system', content: part.content })
    } else if (part.role === 'user') {
      const content = part.content
        .map((c) => {
          if (c.type === 'text') return c.text
          return ''
        })
        .join('')
      messages.push({ role: 'user', content })
    } else if (part.role === 'assistant') {
      // Extract tool calls - we'll process them after collecting results
      for (const c of part.content) {
        if (c.type === 'tool-call') {
          toolCalls.push({
            id: c.toolCallId,
            name: c.toolName,
            arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input),
          })
        } else if (c.type === 'text' && c.text.trim()) {
          // If there's text content without tool calls, add it
          // (This handles the final response case)
          if (toolCalls.length === 0) {
            messages.push({ role: 'assistant', content: c.text })
          }
        }
      }
    } else if (part.role === 'tool') {
      // Collect tool results into a map by tool_call_id
      for (const toolResult of part.content) {
        if (toolResult.type === 'tool-result') {
          const outputValue = toolResult.output
          let contentStr: string
          if (typeof outputValue === 'string') {
            contentStr = outputValue
          } else if (Array.isArray(outputValue)) {
            contentStr = outputValue
              .map((outputPart: { type: string; text?: string }) => {
                if (outputPart.type === 'text' && outputPart.text) return outputPart.text
                return JSON.stringify(outputPart)
              })
              .join('')
          } else {
            contentStr = JSON.stringify(outputValue)
          }
          toolResults.set(toolResult.toolCallId, {
            toolCallId: toolResult.toolCallId,
            content: contentStr,
          })
        }
      }
    }
  }

  // Second pass: interleave tool calls with their results
  // Each tool call gets its own assistant message, followed by its result
  for (const tc of toolCalls) {
    const result = toolResults.get(tc.id)

    // Add assistant message with this ONE tool call
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        },
      ],
    })

    // Add the corresponding tool result (if we have it)
    if (result) {
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.content,
      })
    }
  }

  return messages
}

/**
 * Build request prompt string for verification
 */
function buildRequestPrompt(messages: EigenAIMessage[]): string {
  return messages.map((m) => m.content ?? '').join('')
}

/**
 * Map EigenAI finish reason to LanguageModelV2 finish reason
 */
function mapFinishReason(reason: string | null): LanguageModelV2FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool_calls':
      return 'tool-calls'
    case 'content_filter':
      return 'content-filter'
    default:
      return 'stop'
  }
}

// =============================================================================
// EigenAI Model Implementation
// =============================================================================

/**
 * Create an EigenAI model that implements Vercel AI SDK's LanguageModelV2 interface.
 *
 * @example
 * ```typescript
 * // Option 1: API Key auth (simpler)
 * const model = createEigenAIModel({
 *   apiKey: process.env.EIGENAI_API_KEY,
 * })
 *
 * // Option 2: Wallet signing (verifiable)
 * const model = createEigenAIModel({
 *   privateKey: process.env.EIGENAI_PRIVATE_KEY as `0x${string}`,
 *   onVerification: (data) => {
 *     // Store verification data for Recall submission
 *     console.log('Verification:', data.signature)
 *   },
 * })
 *
 * // Use with Vercel AI SDK
 * const result = await generateText({ model, prompt: 'Hello' })
 * ```
 */
export function createEigenAIModel(options: CreateEigenAIModelOptions): LanguageModelV2 {
  const { apiKey, privateKey, onVerification } = options
  const modelId = options.modelId ?? DEFAULT_MODELS.eigenai

  // Determine auth mode: API key takes precedence
  const useApiKeyAuth = !!apiKey

  // Use correct API URL based on auth type:
  // - API key auth → eigenai.eigencloud.xyz
  // - Wallet auth → determinal-api.eigenarcade.com
  const apiUrl = options.apiUrl ?? getEigenAIApiUrl(useApiKeyAuth)

  // Validate that we have at least one auth method
  if (!apiKey && !privateKey) {
    throw new Error(
      'EigenAI requires either apiKey or privateKey for authentication.\n' +
        'Set EIGENAI_API_KEY for simple auth or EIGENAI_PRIVATE_KEY for verifiable inference.'
    )
  }

  // Create wallet account for signing (only if using wallet auth)
  const account = privateKey ? privateKeyToAccount(privateKey) : null
  const walletAddress = account?.address ?? ''

  /**
   * Sign a message with the wallet
   */
  async function signMessage(message: string): Promise<string> {
    if (!account) throw new Error('Wallet signing requires privateKey')
    return account.signMessage({ message })
  }

  /**
   * Get grant message from EigenAI (only for wallet auth)
   */
  async function getGrantMessage(): Promise<string> {
    if (!walletAddress) throw new Error('Grant message requires privateKey')
    const response = await fetch(`${apiUrl}/message?address=${walletAddress}`)

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
      throw new APICallError({
        message: `Failed to get grant message: ${response.status}`,
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: JSON.stringify(body),
        url: `${apiUrl}/message`,
        requestBodyValues: { address: walletAddress },
        data: {
          provider: 'eigenai',
          providerCode: parseEigenAIErrorCode(body),
          providerRawError: body,
        },
      })
    }

    const data = (await response.json()) as EigenAIGrantResponse
    return data.message
  }

  /**
   * Build headers for API request
   */
  function buildHeaders(): Record<string, string> {
    if (useApiKeyAuth) {
      return {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey!,
      }
    }
    return {
      'Content-Type': 'application/json',
    }
  }

  /**
   * Build request body with appropriate auth fields
   */
  async function buildAuthFields(): Promise<Record<string, string>> {
    if (useApiKeyAuth) {
      // API key auth doesn't need additional body fields
      return {}
    }
    // Wallet auth needs grant message and signature
    const grantMessage = await getGrantMessage()
    const grantSignature = await signMessage(grantMessage)
    return {
      grantMessage,
      grantSignature,
      walletAddress,
    }
  }

  return {
    specificationVersion: 'v2',
    provider: 'eigenai',
    modelId,

    // EigenAI doesn't support any URLs natively
    supportedUrls: {},

    /**
     * Non-streaming completion
     */
    async doGenerate(callOptions: LanguageModelV2CallOptions) {
      const messages = convertPromptToMessages(callOptions.prompt)

      // Convert tools to OpenAI-compatible format
      const tools = callOptions.tools
        ?.filter(
          (
            tool
          ): tool is {
            type: 'function'
            name: string
            description?: string
            inputSchema: Record<string, unknown>
          } => tool.type === 'function'
        )
        .map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema, // AI SDK uses inputSchema, OpenAI API expects parameters
          },
        }))

      // Convert toolChoice to OpenAI-compatible format
      let toolChoice: string | { type: 'function'; function: { name: string } } | undefined
      if (callOptions.toolChoice) {
        if (callOptions.toolChoice.type === 'auto') {
          toolChoice = 'auto'
        } else if (callOptions.toolChoice.type === 'none') {
          toolChoice = 'none'
        } else if (callOptions.toolChoice.type === 'required') {
          toolChoice = 'required'
        } else if (callOptions.toolChoice.type === 'tool') {
          toolChoice = { type: 'function', function: { name: callOptions.toolChoice.toolName } }
        }
      }

      // Count tool results - if we have too many, force the model to stop calling tools
      // gpt-oss-120b-f16 doesn't know when to stop AND can't produce text output
      // So when limit is reached, we synthesize a decision based on the tool calls made
      const MAX_TOOL_RESULTS = 8
      const toolResultCount = messages.filter((m) => m.role === 'tool').length

      if (toolResultCount >= MAX_TOOL_RESULTS) {
        console.log(
          `[EigenAI] Tool result limit reached (${toolResultCount}/${MAX_TOOL_RESULTS}), synthesizing decision`
        )

        // Check if executeSwap was called - if so, trade was executed
        const executeSwapCalled = messages.some(
          (m) =>
            m.role === 'assistant' && m.tool_calls?.some((tc) => tc.function.name === 'executeSwap')
        )

        // Synthesize a decision based on what happened
        let syntheticDecision: string
        if (executeSwapCalled) {
          syntheticDecision = JSON.stringify({
            reasoning: 'Trade was executed via executeSwap tool call.',
            trade_decisions: [
              {
                token: 'UNKNOWN',
                action: 'EXECUTED',
                amount_usd: 0,
                rationale: 'Trade executed - see swap transaction logs for details',
              },
            ],
          })
        } else {
          syntheticDecision = JSON.stringify({
            reasoning:
              'After gathering market data (prices, indicators, sentiment, pool metrics), no clear trading opportunity was identified. Holding current positions.',
            trade_decisions: [
              {
                token: 'ALL',
                action: 'HOLD',
                amount_usd: 0,
                rationale: 'Insufficient conviction for trade based on gathered data',
              },
            ],
          })
        }

        // Return synthetic response - don't make another API call
        const syntheticContent: LanguageModelV2Content[] = [
          { type: 'text', text: syntheticDecision },
        ]

        return {
          content: syntheticContent,
          text: syntheticDecision,
          finishReason: 'stop' as const,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
          response: {
            id: `synthetic-${Date.now()}`,
            timestamp: new Date(),
            modelId,
            headers: {},
          },
          warnings: [],
          providerMetadata: {
            eigenai: {
              synthetic: true,
              toolResultCount,
              executeSwapCalled,
            },
          },
          rawCall: {
            rawPrompt: messages,
            rawSettings: { model: modelId },
          },
        }
      }

      // Build auth fields (API key uses headers, wallet uses body fields)
      const authFields = await buildAuthFields()

      // Determine the correct API endpoint
      // API key auth uses /v1/chat/completions, wallet auth uses /api/chat/completions
      const endpoint = useApiKeyAuth
        ? `${apiUrl}/v1/chat/completions`
        : `${apiUrl}/api/chat/completions`

      // Make chat completion request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          messages,
          model: modelId,
          max_tokens: callOptions.maxOutputTokens ?? 4096,
          temperature: callOptions.temperature,
          top_p: callOptions.topP,
          // Include tools if provided (we return early above if limit reached)
          ...(tools?.length ? { tools, tool_choice: toolChoice ?? 'auto' } : {}),
          // Include auth fields for wallet auth (empty for API key auth)
          ...authFields,
        }),
        signal: callOptions.abortSignal,
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
        throw new APICallError({
          message: `EigenAI API error: ${response.status}`,
          statusCode: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: JSON.stringify(body),
          url: `${apiUrl}/api/chat/completions`,
          requestBodyValues: { model: modelId, messages: messages.length },
          data: {
            provider: 'eigenai',
            providerCode: parseEigenAIErrorCode(body),
            providerRawError: body,
          },
        })
      }

      const data = (await response.json()) as EigenAIChatCompletionResponse

      // Extract content and tool calls from choices
      const choice = data.choices[0]
      const textContent = choice?.message.content ?? ''
      const toolCalls = choice?.message.tool_calls ?? []

      // Build content array with text and/or tool calls
      const content: LanguageModelV2Content[] = []

      // Add text content if present
      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        })
      }

      // Add tool calls if present
      for (const tc of toolCalls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.id,
          toolName: tc.function.name,
          input: tc.function.arguments, // Already a stringified JSON from EigenAI
        })
      }

      // For verification, combine text and tool call info
      const outputForVerification = textContent || JSON.stringify(toolCalls)

      // Build verification data
      const verificationData: EigenAIVerificationData = {
        requestPrompt: buildRequestPrompt(messages),
        responseModel: data.model,
        responseOutput: outputForVerification,
        signature: data.signature,
        walletAddress,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
      }

      // Call verification callback if provided
      if (onVerification) {
        // Fire-and-forget, don't block response
        Promise.resolve(onVerification(verificationData)).catch((err: unknown) => {
          console.error('EigenAI verification callback error:', err)
        })
      }

      const warnings: LanguageModelV2CallWarning[] = []

      const usage: LanguageModelV2Usage = {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      }

      const result = {
        content,
        text: textContent,
        finishReason: mapFinishReason(choice?.finish_reason ?? 'stop'),
        usage,
        warnings,
        response: {
          id: data.id,
          modelId: data.model,
        },
        providerMetadata: {
          eigenai: {
            signature: data.signature,
            walletAddress: verificationData.walletAddress,
            requestPrompt: verificationData.requestPrompt,
            responseModel: verificationData.responseModel,
            responseOutput: verificationData.responseOutput,
          },
        },
      }
      return result
    },

    /**
     * Streaming completion
     */
    async doStream(callOptions: LanguageModelV2CallOptions) {
      const messages = convertPromptToMessages(callOptions.prompt)

      // Build auth fields
      const authFields = await buildAuthFields()

      // Determine the correct API endpoint
      const endpoint = useApiKeyAuth
        ? `${apiUrl}/v1/chat/completions`
        : `${apiUrl}/api/chat/completions`

      // Make streaming chat completion request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          messages,
          model: modelId,
          max_tokens: callOptions.maxOutputTokens ?? 4096,
          temperature: callOptions.temperature,
          top_p: callOptions.topP,
          stream: true,
          ...authFields,
        }),
        signal: callOptions.abortSignal,
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
        throw new APICallError({
          message: `EigenAI API error: ${response.status}`,
          statusCode: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: JSON.stringify(body),
          url: `${apiUrl}/api/chat/completions`,
          requestBodyValues: { model: modelId, messages: messages.length, stream: true },
          data: {
            provider: 'eigenai',
            providerCode: parseEigenAIErrorCode(body),
            providerRawError: body,
          },
        })
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let finalSignature = ''
      let finalUsage: LanguageModelV2Usage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
      let responseModel = modelId
      let responseId = ''
      const textPartId = `text-${Date.now()}`
      let streamStarted = false

      const warnings: LanguageModelV2CallWarning[] = []

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async pull(controller) {
          // Emit stream-start as first event
          if (!streamStarted) {
            streamStarted = true
            controller.enqueue({
              type: 'stream-start',
              warnings,
            })
            controller.enqueue({
              type: 'text-start',
              id: textPartId,
            })
          }

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const result = await reader.read()
            const done = result.done
            const value = result.value as Uint8Array | undefined

            if (done) {
              // End text part
              controller.enqueue({
                type: 'text-end',
                id: textPartId,
              })

              // Build verification data from accumulated content
              if (finalSignature && onVerification) {
                const verificationData: EigenAIVerificationData = {
                  requestPrompt: buildRequestPrompt(messages),
                  responseModel,
                  responseOutput: fullContent,
                  signature: finalSignature,
                  walletAddress,
                  usage: {
                    promptTokens: finalUsage.inputTokens ?? 0,
                    completionTokens: finalUsage.outputTokens ?? 0,
                    totalTokens: finalUsage.totalTokens ?? 0,
                  },
                }
                Promise.resolve(onVerification(verificationData)).catch((err: unknown) => {
                  console.error('EigenAI verification callback error:', err)
                })
              }

              // Emit response metadata
              controller.enqueue({
                type: 'response-metadata',
                id: responseId,
                modelId: responseModel,
              })

              // Emit finish
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: finalUsage,
                providerMetadata: {
                  eigenai: { signature: finalSignature },
                },
              })
              controller.close()
              return
            }

            if (value) {
              buffer += decoder.decode(value, { stream: true })
            }

            // Parse SSE events
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? '' // Keep incomplete line in buffer

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const chunk = JSON.parse(data) as EigenAIStreamChunk

                // Update model and id from response
                responseModel = chunk.model
                responseId = chunk.id

                // Extract text delta
                const delta = chunk.choices[0]?.delta
                if (delta?.content) {
                  fullContent += delta.content
                  controller.enqueue({
                    type: 'text-delta',
                    id: textPartId,
                    delta: delta.content,
                  })
                }

                // Capture signature (usually in last chunk)
                if (chunk.signature) {
                  finalSignature = chunk.signature
                }

                // Capture usage (usually in last chunk)
                if (chunk.usage) {
                  finalUsage = {
                    inputTokens: chunk.usage.prompt_tokens,
                    outputTokens: chunk.usage.completion_tokens,
                    totalTokens: chunk.usage.prompt_tokens + chunk.usage.completion_tokens,
                  }
                }
              } catch {
                // Ignore JSON parse errors for malformed chunks
              }
            }
          }
        },
      })

      return {
        stream,
      }
    },
  }
}
