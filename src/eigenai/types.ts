/**
 * TypeScript types for EigenAI dTERMinal API integration
 *
 * These types define the request/response formats for:
 * - Grant authentication flow
 * - Chat completion API
 * - Signature verification
 *
 * @module eigenai/types
 */

// =============================================================================
// Grant Authentication Types
// =============================================================================

/**
 * Response from GET /message endpoint
 *
 * Returns the message that must be signed by the grant wallet to authenticate
 * with dTERMinal API.
 *
 * @example
 * ```typescript
 * const response = await fetch(
 *   `https://determinal-api.eigenarcade.com/message?address=${walletAddress}`
 * )
 * const data: GrantMessageResponse = await response.json()
 * // data.message = "I authorize inference usage for wallet 0x..."
 * ```
 */
export interface GrantMessageResponse {
  /**
   * Whether the request was successful
   */
  success: boolean

  /**
   * The message that must be signed by the wallet
   *
   * This message should be signed using the grant wallet's private key,
   * and the resulting signature included in all chat completion requests.
   */
  message: string

  /**
   * The wallet address this message is for
   */
  address: string
}

/**
 * Response from GET /checkGrant endpoint
 *
 * Returns the current grant status for a wallet, including remaining tokens
 * and expiration time.
 */
export interface GrantCheckResponse {
  /**
   * Whether the request was successful
   */
  success: boolean

  /**
   * Whether this wallet has an active grant
   */
  hasGrant: boolean

  /**
   * Grant details (only present if hasGrant is true)
   */
  grant?: {
    /**
     * Number of inference tokens remaining in this grant
     */
    remainingTokens: number

    /**
     * Total inference tokens allocated in this grant
     */
    totalTokens: number

    /**
     * ISO 8601 timestamp when this grant expires
     *
     * @example "2025-12-31T23:59:59Z"
     */
    expiresAt: string
  }
}

/**
 * Cached grant authentication data
 *
 * Stores a signed grant message that can be reused for multiple API calls
 * until it expires or becomes invalid.
 */
export interface CachedGrant {
  /**
   * The original grant message that was signed
   */
  message: string

  /**
   * The ECDSA signature of the message (0x-prefixed hex string, 65 bytes)
   */
  signature: string

  /**
   * The wallet address that signed the message
   */
  walletAddress: string

  /**
   * When this grant was cached (for expiry detection)
   */
  cachedAt: Date

  /**
   * Remaining tokens in the grant (for monitoring)
   */
  remainingTokens?: number
}

// =============================================================================
// Chat Completion Types
// =============================================================================

/**
 * Chat message role types
 *
 * Standard OpenAI-compatible role types for chat messages.
 */
export type ChatMessageRole = 'system' | 'user' | 'assistant'

/**
 * A single message in a chat conversation
 */
export interface ChatMessage {
  /**
   * The role of the message author
   */
  role: ChatMessageRole

  /**
   * The content of the message
   */
  content: string
}

/**
 * Request body for POST /api/chat/completions
 *
 * Extends standard OpenAI chat completion request with EigenAI-specific
 * grant authentication fields.
 *
 * @example
 * ```typescript
 * const request: ChatCompletionRequest = {
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   model: 'gpt-oss-120b-f16',
 *   max_tokens: 150,
 *   seed: 42,
 *   grantMessage: '...',
 *   grantSignature: '0x...',
 *   walletAddress: '0x...'
 * }
 * ```
 */
export interface ChatCompletionRequest {
  /**
   * The conversation messages to generate a response for
   */
  messages: ChatMessage[]

  /**
   * The model ID to use for generation
   *
   * @default 'gpt-oss-120b-f16'
   */
  model: string

  /**
   * Maximum number of tokens to generate
   *
   * @default undefined (model default)
   */
  max_tokens?: number

  /**
   * Random seed for deterministic generation
   *
   * @default undefined (non-deterministic)
   */
  seed?: number

  /**
   * Temperature for sampling (0-2)
   *
   * Lower values make output more focused and deterministic.
   * Higher values make output more random and creative.
   *
   * @default 1.0
   */
  temperature?: number

  /**
   * Top-p (nucleus) sampling parameter (0-1)
   *
   * @default 1.0
   */
  top_p?: number

  // ============================================================================
  // EigenAI Grant Authentication Fields
  // ============================================================================

  /**
   * The grant message from GET /message endpoint
   *
   * @required for dTERMinal API authentication
   */
  grantMessage: string

  /**
   * ECDSA signature of the grant message
   *
   * Signed by the grant wallet's private key.
   * Format: 0x-prefixed 65-byte hex string (130 hex characters)
   *
   * @required for dTERMinal API authentication
   */
  grantSignature: string

  /**
   * The wallet address that signed the grant message
   *
   * Format: 0x-prefixed 40-character hex string
   *
   * @required for dTERMinal API authentication
   */
  walletAddress: string
}

/**
 * Response from POST /api/chat/completions
 *
 * Standard OpenAI-compatible chat completion response with EigenAI-specific
 * signature field for verification.
 */
export interface ChatCompletionResponse {
  /**
   * Unique identifier for this completion
   */
  id: string

  /**
   * Object type (always 'chat.completion')
   */
  object: string

  /**
   * Unix timestamp when this completion was created
   */
  created: number

  /**
   * The model that generated this completion
   */
  model: string

  /**
   * System fingerprint for cache busting and version tracking
   */
  system_fingerprint: string

  /**
   * The generated completion choices
   */
  choices: Array<{
    /**
     * Index of this choice
     */
    index: number

    /**
     * The generated message
     */
    message: {
      /**
       * Role of the generated message (typically 'assistant')
       */
      role: string

      /**
       * The generated text content
       */
      content: string
    }

    /**
     * Reason why generation stopped
     *
     * - `stop`: Natural completion
     * - `length`: Reached max_tokens limit
     * - `content_filter`: Content filtered
     */
    finish_reason: 'stop' | 'length' | 'content_filter' | string

    /**
     * Provider-specific fields (not used for verification)
     */
    provider_specific_fields?: Record<string, unknown>
  }>

  /**
   * Token usage statistics for this completion
   */
  usage: {
    /**
     * Number of tokens in the prompt
     */
    prompt_tokens: number

    /**
     * Number of tokens generated in the completion
     */
    completion_tokens: number

    /**
     * Total tokens used (prompt + completion)
     */
    total_tokens: number
  }

  /**
   * ECDSA signature of this completion (EigenAI-specific)
   *
   * Signs: ChainID + ModelID + FullPrompt + FullOutput (concatenated)
   *
   * Format: 65-byte hex string (130 characters, no 0x prefix)
   * Components: r (32 bytes) + s (32 bytes) + v (1 byte)
   *
   * This signature can be verified to prove the response came from EigenAI.
   */
  signature: string
}

// =============================================================================
// Signature Verification Types
// =============================================================================

/**
 * Result of signature verification
 *
 * Contains the verification outcome and details about the signer address.
 */
export interface SignatureVerificationResult {
  /**
   * Whether the signature is valid
   *
   * `true` if the recovered signer matches the expected signer address.
   */
  isValid: boolean

  /**
   * The address recovered from the signature via ECDSA recovery
   *
   * This should match the expected signer address if the signature is valid.
   */
  recoveredAddress: string

  /**
   * The expected signer address for this network
   *
   * For dTERMinal API (mainnet): 0x7053bfb0433a16a2405de785d547b1b32cee0cf3
   */
  expectedSigner: string

  /**
   * The reconstructed message that was signed
   *
   * Format: ChainID + ModelID + FullPrompt + FullOutput
   *
   * Useful for debugging signature verification failures.
   */
  reconstructedMessage: string

  /**
   * Error message if verification failed
   */
  error?: string
}

/**
 * Data required to verify a chat completion signature
 *
 * Contains the original request and response needed to reconstruct
 * the signed message.
 */
export interface SignatureVerificationData {
  /**
   * The original chat completion request (for prompt reconstruction)
   */
  request: ChatCompletionRequest

  /**
   * The chat completion response (for output and signature)
   */
  response: ChatCompletionResponse

  /**
   * Network chain ID used for signing
   *
   * For dTERMinal API, this is always '1' (mainnet)
   */
  chainId: string

  /**
   * Expected signer address for this network
   */
  expectedSigner: string
}

// =============================================================================
// Database/Storage Types
// =============================================================================

/**
 * Signature submission record for database storage
 *
 * Tracks signatures captured from EigenAI responses, their verification status,
 * and submission to Recall API.
 */
export interface SignatureSubmission {
  /**
   * Unique identifier for this submission
   */
  id?: string

  /**
   * Trading diary entry ID (links signature to specific trading iteration)
   */
  diaryId?: string

  /**
   * Trading iteration number when this signature was captured
   */
  iterationNumber: number

  /**
   * The 65-byte ECDSA signature (hex string)
   */
  signature: string

  /**
   * The model ID that generated this response
   */
  modelId: string

  /**
   * SHA256 hash of the request (for audit trail)
   */
  requestHash: string

  /**
   * SHA256 hash of the response (for audit trail)
   */
  responseHash: string

  /**
   * Full request object (optional, for debugging)
   */
  fullRequest?: ChatCompletionRequest

  /**
   * Full response object (optional, for debugging)
   */
  fullResponse?: ChatCompletionResponse

  /**
   * Local verification status
   */
  localVerificationStatus: 'pending' | 'verified' | 'invalid'

  /**
   * Address recovered from signature during verification
   */
  recoveredSigner?: string

  /**
   * Error message if verification failed
   */
  verificationError?: string

  /**
   * Whether this signature has been submitted to Recall API
   */
  submittedToRecall: boolean

  /**
   * Timestamp when submitted to Recall API
   */
  recallSubmittedAt?: Date

  /**
   * Error message from Recall API submission (if any)
   */
  recallSubmissionError?: string

  /**
   * Number of retry attempts for Recall submission
   */
  recallSubmissionRetries?: number

  /**
   * When this record was created
   */
  createdAt?: Date

  /**
   * When this record was last updated
   */
  updatedAt?: Date
}

// =============================================================================
// Recall API Types
// =============================================================================

/**
 * Request body for POST /api/agents/{agentId}/eigenai/verify
 *
 * Submits a verified signature to Recall API for competition compliance tracking.
 */
export interface RecallVerificationRequest {
  /**
   * The ECDSA signature to verify
   */
  signature: string

  /**
   * Competition ID this verification is for
   */
  competitionId: string

  /**
   * The original chat completion request (for verification)
   */
  request: {
    /**
     * Model ID
     */
    model: string

    /**
     * Messages array (for prompt reconstruction)
     */
    messages: ChatMessage[]
  }

  /**
   * The chat completion response (for verification)
   */
  response: {
    /**
     * Model ID from response
     */
    model: string

    /**
     * Generated choices (for output reconstruction)
     */
    choices: Array<{
      message: {
        content: string
      }
    }>
  }
}

/**
 * Response from POST /api/agents/{agentId}/eigenai/verify
 */
export interface RecallVerificationResponse {
  /**
   * Whether the API call succeeded
   */
  success: boolean

  /**
   * Whether the signature was verified as valid
   */
  verified: boolean

  /**
   * Human-readable message about the verification result
   */
  message: string

  /**
   * Error details if verification failed
   */
  error?: string
}
