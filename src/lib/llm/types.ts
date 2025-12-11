/**
 * LLM Provider Types
 *
 * Type definitions for the abstracted LLM provider layer.
 */

/** Supported LLM providers */
export type LLMProviderType = 'anthropic' | 'openai' | 'eigenai'

/**
 * LLM configuration from environment variables
 */
export interface LLMConfig {
  /** The provider to use */
  provider: LLMProviderType
  /** Override for the model ID */
  model?: string
  /** Custom base URL (for proxies or custom endpoints) */
  baseUrl?: string
}

/**
 * Default models by provider
 *
 * Note: EigenAI's gpt-oss-120b-f16 is a tool-calling only model (no text output).
 * Trades are executed directly via the executeSwap tool.
 */
export const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
  eigenai: 'gpt-oss-120b-f16',
}

// =============================================================================
// EigenAI-specific types
// =============================================================================

/**
 * EigenAI API URLs by authentication type.
 *
 * - Wallet signing (private key) → determinal-api.eigenarcade.com
 * - API key → eigenai.eigencloud.xyz
 */
export const EIGENAI_API_URLS = {
  /** URL for wallet signing auth (verifiable inference) */
  walletAuth: 'https://determinal-api.eigenarcade.com',
  /** URL for API key auth (simpler) */
  apiKeyAuth: 'https://eigenai.eigencloud.xyz',
} as const

/**
 * Get the EigenAI API URL based on authentication type.
 *
 * @param useApiKey - If true, returns the API key URL; otherwise wallet auth URL
 * @returns The appropriate API URL
 */
export function getEigenAIApiUrl(useApiKey?: boolean): string {
  // If env var is set, always use it
  if (process.env.EIGENAI_API_URL) {
    return process.env.EIGENAI_API_URL
  }
  // Otherwise, pick based on auth type
  return useApiKey ? EIGENAI_API_URLS.apiKeyAuth : EIGENAI_API_URLS.walletAuth
}

/**
 * Get the EigenAI model ID from environment or use default.
 */
export function getEigenAIModelId(): string {
  return process.env.EIGENAI_MODEL_ID ?? DEFAULT_MODELS.eigenai
}

/** Chain ID for EigenAI message signing (mainnet) */
export const EIGENAI_CHAIN_ID = '1'

/** Expected signer address for EigenAI signature verification */
export const EIGENAI_EXPECTED_SIGNER = '0x7053bfb0433a16a2405de785d547b1b32cee0cf3'

/**
 * EigenAI grant message response
 */
export interface EigenAIGrantResponse {
  success: boolean
  message: string
  address: string
}

/**
 * EigenAI grant check response
 */
export interface EigenAIGrantCheckResponse {
  success: boolean
  hasGrant: boolean
  grant?: {
    remainingTokens: number
    totalTokens: number
    expiresAt: string
  }
}

/**
 * EigenAI tool call in response
 */
export interface EigenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * EigenAI chat completion response
 */
export interface EigenAIChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content?: string
      tool_calls?: EigenAIToolCall[]
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  signature: string
}

/**
 * EigenAI streaming chunk (SSE format)
 */
export interface EigenAIStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: { role?: string; content?: string }
    finish_reason: string | null
  }>
  /** Signature is only present in the final chunk */
  signature?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Verification data for EigenAI inference.
 * This is the data needed to verify the signature or submit to Recall.
 */
export interface EigenAIVerificationData {
  /** Concatenated prompt content */
  requestPrompt: string
  /** Model ID from response */
  responseModel: string
  /** Full output content */
  responseOutput: string
  /** Cryptographic signature from EigenAI */
  signature: string
  /** Token usage */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * EigenAI-specific error codes
 */
export type EigenAIErrorCode =
  | 'grant_expired'
  | 'grant_not_found'
  | 'insufficient_tokens'
  | 'invalid_signature'
  | 'rate_limited'
  | 'unknown'
