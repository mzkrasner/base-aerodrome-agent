/**
 * LLM Provider Abstraction
 *
 * Provides a unified interface for different LLM providers.
 * Configuration is read from environment variables:
 *
 * - LLM_PROVIDER: 'anthropic' | 'openai' | 'eigenai' (default: 'anthropic')
 * - LLM_MODEL: Override the default model
 * - LLM_BASE_URL: Custom API endpoint
 *
 * Provider-specific environment variables:
 * - ANTHROPIC_API_KEY: For Anthropic
 * - OPENAI_API_KEY: For OpenAI
 * - EIGENAI_API_KEY: For EigenAI (simple auth, uses eigenai.eigencloud.xyz)
 * - EIGENAI_PRIVATE_KEY: For EigenAI (wallet signing, uses determinal-api.eigenarcade.com)
 *
 * @example
 * ```typescript
 * import { getModel } from '../lib/llm'
 *
 * const agent = new Agent({
 *   model: getModel(),
 *   // ...
 * })
 * ```
 */
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'

import { getLLMConfig, validateProviderEnv } from './config'
import { createEigenAIModel } from './providers/eigenai'
import { DEFAULT_MODELS, type EigenAIVerificationData, type LLMProviderType } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Type alias for Mastra-compatible models.
 * Uses union of actual return types from provider functions.
 * Mastra's Agent accepts both V1 (Anthropic/OpenAI) and V2 (EigenAI) models.
 */
export type MastraCompatibleModel =
  | ReturnType<typeof anthropic>
  | ReturnType<typeof openai>
  | ReturnType<typeof createEigenAIModel>

// =============================================================================
// Module State
// =============================================================================

/**
 * Global callback for EigenAI verification data.
 * Set this to capture verification data for storage/submission to Recall.
 */
let eigenaiVerificationCallback:
  | ((data: EigenAIVerificationData) => void | Promise<void>)
  | undefined

// =============================================================================
// Functions
// =============================================================================

/**
 * Set the global EigenAI verification callback.
 *
 * @param callback - Function called with verification data after each EigenAI inference
 */
export function setEigenAIVerificationCallback(
  callback: (data: EigenAIVerificationData) => void | Promise<void>
): void {
  eigenaiVerificationCallback = callback
}

/**
 * Get the configured LLM model.
 *
 * Reads configuration from environment variables and returns the appropriate
 * Vercel AI SDK model instance.
 *
 * @param overrides - Optional overrides for provider and model
 * @returns Mastra-compatible model (LanguageModelV1 or V2)
 * @throws Error if required environment variables are missing
 *
 * @example
 * ```typescript
 * // Use environment config
 * const model = getModel()
 *
 * // Override provider
 * const model = getModel({ provider: 'openai' })
 *
 * // Override model
 * const model = getModel({ model: 'claude-opus-4-1' })
 * ```
 */
export function getModel(overrides?: {
  provider?: LLMProviderType
  model?: string
}): MastraCompatibleModel {
  const config = getLLMConfig()
  const provider = overrides?.provider ?? config.provider

  // Validate environment variables
  validateProviderEnv(provider)

  switch (provider) {
    case 'anthropic': {
      const modelId = overrides?.model ?? config.model ?? DEFAULT_MODELS[provider]
      return anthropic(modelId)
    }

    case 'openai': {
      const modelId = overrides?.model ?? config.model ?? DEFAULT_MODELS[provider]
      return openai(modelId)
    }

    case 'eigenai': {
      // EigenAI uses EIGENAI_MODEL_ID env var for model selection
      const modelId =
        overrides?.model ?? process.env.EIGENAI_MODEL_ID ?? config.model ?? DEFAULT_MODELS[provider]
      // Support both API key and private key auth
      const apiKey = process.env.EIGENAI_API_KEY
      const privateKey = process.env.EIGENAI_PRIVATE_KEY as `0x${string}` | undefined
      return createEigenAIModel({
        modelId,
        apiKey,
        privateKey,
        onVerification: eigenaiVerificationCallback,
      })
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}

/**
 * Get the model string for use with Mastra agents.
 *
 * When using gateways, pass this string to the agent's `model` property.
 * The gateway will resolve it to the actual model instance.
 *
 * Configuration via environment variables:
 * - LLM_PROVIDER: 'anthropic' | 'openai' | 'eigenai' (default: 'anthropic')
 * - LLM_MODEL: Override default model
 * - EIGENAI_MODEL_ID: Override EigenAI model (default: 'gpt-oss-120b-f16')
 *
 * @param overrides - Optional overrides for provider and model
 * @returns Model string for Mastra (e.g., 'anthropic/claude-sonnet-4-5' or 'eigenai/inference/gpt-oss-120b-f16')
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   model: getModelString(), // Uses env config
 *   // ...
 * })
 * ```
 */
export function getModelString(overrides?: { provider?: LLMProviderType; model?: string }): string {
  const config = getLLMConfig()
  const provider = overrides?.provider ?? config.provider

  switch (provider) {
    case 'anthropic': {
      const modelId = overrides?.model ?? config.model ?? DEFAULT_MODELS.anthropic
      return `anthropic/${modelId}`
    }
    case 'openai': {
      const modelId = overrides?.model ?? config.model ?? DEFAULT_MODELS.openai
      return `openai/${modelId}`
    }
    case 'eigenai': {
      // For EigenAI, use EIGENAI_MODEL_ID env var or override or default
      const modelId = overrides?.model ?? process.env.EIGENAI_MODEL_ID ?? DEFAULT_MODELS.eigenai
      return `eigenai/inference/${modelId}`
    }
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unknown provider: ${_exhaustive}`)
    }
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export { getLLMConfig, validateEigenAIConfig, validateProviderEnv } from './config'
export { createEigenAIModel, type CreateEigenAIModelOptions } from './providers/eigenai'
export {
  EigenAIGateway,
  eigenaiGateway,
  getEigenAIModelString,
  setVerificationCallback as setEigenAIGatewayVerificationCallback,
} from './gateways'
export {
  DEFAULT_MODELS,
  EIGENAI_API_URLS,
  EIGENAI_CHAIN_ID,
  EIGENAI_EXPECTED_SIGNER,
  getEigenAIApiUrl,
  getEigenAIModelId,
  type EigenAIVerificationData,
  type LLMConfig,
  type LLMProviderType,
} from './types'
