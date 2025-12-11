/**
 * EigenAI Gateway for Mastra
 *
 * Custom gateway implementation for EigenAI Inference API.
 * Supports two authentication methods:
 * 1. API Key (simpler) - Set EIGENAI_API_KEY
 * 2. Wallet Signing (verifiable) - Set EIGENAI_PRIVATE_KEY
 *
 * If both are set, API key takes precedence.
 *
 * Configuration via environment variables:
 * - EIGENAI_API_URL: API endpoint (default: https://eigenai.eigencloud.xyz)
 * - EIGENAI_API_KEY: Simple API key auth (recommended for getting started)
 * - EIGENAI_PRIVATE_KEY: Wallet private key for verifiable inference
 *
 * Model string format: eigenai/inference/gpt-oss-120b-f16
 */
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { MastraModelGateway, type ProviderConfig } from '@mastra/core/llm'

import { createEigenAIModel } from '../providers/eigenai'
import { type EigenAIVerificationData, getEigenAIApiUrl, getEigenAIModelId } from '../types'

/**
 * Available EigenAI models.
 *
 * - `gpt-oss-120b-f16` - 120B parameter model (tool-calling only, no text output)
 */
const EIGENAI_MODELS = ['gpt-oss-120b-f16'] as const

/**
 * Callback for verification data capture.
 * Set via setVerificationCallback() to capture inference data for Recall submission.
 */
let verificationCallback: ((data: EigenAIVerificationData) => void | Promise<void>) | undefined

/**
 * Set the callback for capturing EigenAI verification data.
 *
 * @param callback - Function called with verification data after each inference
 */
export function setVerificationCallback(
  callback: (data: EigenAIVerificationData) => void | Promise<void>
): void {
  verificationCallback = callback
}

/**
 * EigenAI Gateway Implementation
 *
 * Extends MastraModelGateway to provide EigenAI model access through Mastra's
 * standard gateway pattern. This enables:
 * - Model routing via string IDs (e.g., 'eigenai/inference/gpt-oss-120b-f16')
 * - Standard Mastra integration
 * - Verifiable inference with cryptographic signatures
 *
 * Note: gpt-oss-120b-f16 is a tool-calling only model and does not produce text output.
 * Trades are executed via the executeSwap tool directly.
 */
export class EigenAIGateway extends MastraModelGateway {
  /**
   * Unique identifier for this gateway.
   * Used as the prefix for all models from this gateway.
   */
  readonly id = 'eigenai'

  /**
   * Human-readable name for the gateway.
   */
  readonly name = 'EigenAI Inference'

  /**
   * Fetch provider configurations.
   * Returns the available models and their configuration.
   */
  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    // Use API key env var if available, otherwise private key
    const useApiKey = !!process.env.EIGENAI_API_KEY
    const apiKeyEnvVar = useApiKey ? 'EIGENAI_API_KEY' : 'EIGENAI_PRIVATE_KEY'

    return {
      inference: {
        name: 'EigenAI Inference',
        models: [...EIGENAI_MODELS],
        apiKeyEnvVar,
        gateway: this.id,
        url: getEigenAIApiUrl(useApiKey),
        docUrl: 'https://eigenarcade.com',
      },
    }
  }

  /**
   * Build the API URL for a model.
   * Uses EIGENAI_API_URL env var or picks based on auth type.
   */
  buildUrl(): string {
    const useApiKey = !!process.env.EIGENAI_API_KEY
    return getEigenAIApiUrl(useApiKey)
  }

  /**
   * Get the API key or private key for authentication.
   * API key takes precedence if both are set.
   *
   * @returns The API key or private key from environment
   * @throws Error if neither is set
   */
  async getApiKey(): Promise<string> {
    const apiKey = process.env.EIGENAI_API_KEY
    const privateKey = process.env.EIGENAI_PRIVATE_KEY

    if (apiKey) {
      return apiKey
    }
    if (privateKey) {
      return privateKey
    }
    throw new Error(
      'Missing EigenAI credentials. Set either:\n' +
        '- EIGENAI_API_KEY for simple authentication\n' +
        '- EIGENAI_PRIVATE_KEY for verifiable inference'
    )
  }

  /**
   * Create a language model instance for the specified model.
   *
   * @param args - Model configuration
   * @param args.modelId - The model ID (e.g., 'gpt-oss-120b-f16')
   * @param args.providerId - The provider ID (e.g., 'inference')
   * @param args.apiKey - The API key or private key
   * @returns LanguageModelV2 instance
   */
  resolveLanguageModel({
    modelId,
    apiKey,
  }: {
    modelId: string
    providerId: string
    apiKey: string
    headers?: Record<string, string>
  }): LanguageModelV2 {
    // Determine auth type based on the key format
    // Private keys are 0x-prefixed 64-char hex strings (66 chars total)
    const isPrivateKey = apiKey.startsWith('0x') && apiKey.length === 66
    const useApiKey = !isPrivateKey

    return createEigenAIModel({
      modelId,
      apiKey: useApiKey ? apiKey : undefined,
      privateKey: isPrivateKey ? (apiKey as `0x${string}`) : undefined,
      apiUrl: getEigenAIApiUrl(useApiKey),
      onVerification: verificationCallback,
    })
  }
}

/**
 * Singleton instance of the EigenAI gateway.
 * Use this when registering with Mastra.
 */
export const eigenaiGateway = new EigenAIGateway()

/**
 * Get the default EigenAI model string for use in agents.
 *
 * @returns Model string 'eigenai/inference/gpt-oss-120b-f16'
 */
export function getEigenAIModelString(): string {
  return `eigenai/inference/${getEigenAIModelId()}`
}
