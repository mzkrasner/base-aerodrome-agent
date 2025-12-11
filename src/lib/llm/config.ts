/**
 * LLM Configuration
 *
 * Loads LLM provider configuration from environment variables.
 */
import type { LLMConfig, LLMProviderType } from './types'

/**
 * Get LLM configuration from environment variables.
 *
 * Environment Variables:
 * - LLM_PROVIDER: 'anthropic' | 'openai' | 'eigenai' (default: 'anthropic')
 * - LLM_MODEL: Override the default model for the provider
 * - LLM_BASE_URL: Custom API endpoint (optional)
 *
 * Provider-specific keys:
 * - ANTHROPIC_API_KEY: For Anthropic provider
 * - OPENAI_API_KEY: For OpenAI provider
 * - EIGENAI_API_KEY: For EigenAI provider (simple auth, takes precedence)
 * - EIGENAI_PRIVATE_KEY: For EigenAI provider (wallet signing, verifiable)
 *
 * @returns LLM configuration
 */
export function getLLMConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic') as LLMProviderType

  // Validate provider
  const validProviders: LLMProviderType[] = ['anthropic', 'openai', 'eigenai']
  if (!validProviders.includes(provider)) {
    throw new Error(
      `Invalid LLM_PROVIDER: "${provider}". ` + `Valid options: ${validProviders.join(', ')}`
    )
  }

  return {
    provider,
    model: process.env.LLM_MODEL,
    baseUrl: process.env.LLM_BASE_URL,
  }
}

/**
 * Validate that required environment variables are set for a provider.
 *
 * @param provider - The LLM provider type
 * @throws Error if required environment variables are missing or invalid
 */
export function validateProviderEnv(provider: LLMProviderType): void {
  switch (provider) {
    case 'anthropic':
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required for Anthropic provider')
      }
      break

    case 'openai':
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider')
      }
      break

    case 'eigenai':
      validateEigenAIConfig()
      break
  }
}

/**
 * Validate EigenAI-specific configuration.
 *
 * Authentication (one required):
 * - EIGENAI_API_KEY: Simple API key auth (takes precedence if both set)
 * - EIGENAI_PRIVATE_KEY: Wallet private key for verifiable inference (0x-prefixed 64-char hex)
 *
 * Optional environment variables:
 * - EIGENAI_API_URL: API endpoint (default: https://eigenai.eigencloud.xyz)
 * - EIGENAI_MODEL_ID: Model to use (default: gpt-oss-120b-f16)
 *
 * @throws Error if neither authentication method is configured
 */
export function validateEigenAIConfig(): void {
  const apiKey = process.env.EIGENAI_API_KEY
  const privateKey = process.env.EIGENAI_PRIVATE_KEY

  // Check that at least one auth method is configured
  if (!apiKey && !privateKey) {
    throw new Error(
      'EigenAI requires either EIGENAI_API_KEY or EIGENAI_PRIVATE_KEY.\n' +
        '- EIGENAI_API_KEY: Simple authentication (recommended for getting started)\n' +
        '- EIGENAI_PRIVATE_KEY: Wallet signing for verifiable inference\n' +
        'If both are set, API key takes precedence.'
    )
  }

  // If using private key, validate its format
  if (privateKey && !apiKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error(
        'EIGENAI_PRIVATE_KEY must be a 0x-prefixed 64-character hex string.\n' +
          'Example format: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      )
    }
  }
}
