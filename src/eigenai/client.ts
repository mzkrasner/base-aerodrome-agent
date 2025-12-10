/**
 * EigenAI Client
 *
 * Provides utilities for capturing and processing EigenAI API responses,
 * including signature extraction and verification.
 *
 * This module is designed to work with the custom fetch wrapper in trading.agent.ts
 * to capture raw API responses for signature verification.
 *
 * @module eigenai/client
 */

import { EIGENAI_CONFIG } from '../config/eigenai.js'
import { grantAuthenticator } from './grant-authenticator.js'
import {
  createAuditHashes,
  verifyEigenAISignature,
} from './signature-verifier.js'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  SignatureSubmission,
} from './types.js'

/**
 * Storage for the last captured API response
 *
 * Used to capture raw responses for signature extraction.
 * This is populated by the custom fetch wrapper.
 */
let lastCapturedResponse: ChatCompletionResponse | null = null

/**
 * Storage for the last captured API request
 *
 * Used alongside the response for signature verification.
 */
let lastCapturedRequest: ChatCompletionRequest | null = null

/**
 * Capture a request/response pair for signature verification
 *
 * Called by the custom fetch wrapper after receiving an API response.
 *
 * @param request - The chat completion request
 * @param response - The chat completion response (with signature)
 */
export function captureRequestResponse(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse
): void {
  lastCapturedRequest = request
  lastCapturedResponse = response
}

/**
 * Get the last captured response
 *
 * @returns The last captured response or null if none
 */
export function getLastCapturedResponse(): ChatCompletionResponse | null {
  return lastCapturedResponse
}

/**
 * Get the last captured request
 *
 * @returns The last captured request or null if none
 */
export function getLastCapturedRequest(): ChatCompletionRequest | null {
  return lastCapturedRequest
}

/**
 * Clear captured request/response
 *
 * Should be called after processing to prevent stale data.
 */
export function clearCapturedData(): void {
  lastCapturedRequest = null
  lastCapturedResponse = null
}

/**
 * Process and verify the last captured response
 *
 * Extracts the signature, verifies it, and returns data ready for database storage.
 *
 * @param iterationNumber - The trading iteration number (for linking)
 * @returns SignatureSubmission data ready for database, or null if no data captured
 *
 * @example
 * ```typescript
 * // After agent.generate() completes
 * const submission = await processAndVerifyLastResponse(iterationNumber)
 *
 * if (submission) {
 *   await eigenaiSignatureRepo.createSubmission(submission)
 * }
 * ```
 */
export async function processAndVerifyLastResponse(
  iterationNumber: number
): Promise<SignatureSubmission | null> {
  const request = lastCapturedRequest
  const response = lastCapturedResponse

  if (!request || !response) {
    return null
  }

  // Check if response has a signature
  if (!response.signature) {
    console.warn('EigenAI response has no signature field')
    return null
  }

  // Verify signature
  const verificationResult = await verifyEigenAISignature(request, response)

  // Create audit hashes
  const { requestHash, responseHash } = createAuditHashes(request, response)

  // Prepare submission data
  const submission: SignatureSubmission = {
    iterationNumber,
    signature: response.signature,
    modelId: response.model,
    requestHash,
    responseHash,
    localVerificationStatus: verificationResult.isValid ? 'verified' : 'invalid',
    recoveredSigner: verificationResult.recoveredAddress,
    verificationError: verificationResult.error,
    submittedToRecall: false,
  }

  // Log verification result
  if (verificationResult.isValid) {
    console.log(`✅ EigenAI signature verified (signer: ${verificationResult.recoveredAddress})`)
  } else {
    console.warn(`⚠️ EigenAI signature verification failed: ${verificationResult.error}`)
    console.warn(`   Recovered: ${verificationResult.recoveredAddress}`)
    console.warn(`   Expected: ${verificationResult.expectedSigner}`)
  }

  // Clear captured data after processing
  clearCapturedData()

  return submission
}

/**
 * Create an authenticated fetch wrapper for EigenAI API
 *
 * This wrapper:
 * 1. Adds grant authentication fields to requests
 * 2. Captures raw responses for signature verification
 *
 * @returns Custom fetch function for use with AI SDK
 *
 * @example
 * ```typescript
 * const authenticatedFetch = await createEigenAIFetch()
 *
 * // Use with AI SDK openai provider
 * const model = openai('gpt-oss-120b-f16', {
 *   baseURL: 'https://determinal-api.eigenarcade.com/api',
 *   fetch: authenticatedFetch,
 * })
 * ```
 */
export async function createEigenAIFetch(): Promise<typeof fetch> {
  // Get grant authentication fields
  const authFields = await grantAuthenticator.getAuthenticationFields()

  // Return custom fetch function
  const customFetch: typeof fetch = async (input, init) => {
    // Only modify POST requests
    if (init?.method === 'POST' && init?.body) {
      try {
        // Parse the request body
        const originalBody = JSON.parse(init.body as string) as Record<string, unknown>

        // Add grant authentication fields
        const authenticatedBody = {
          ...originalBody,
          ...authFields,
        }

        // Create new init with modified body
        const authenticatedInit: RequestInit = {
          ...init,
          body: JSON.stringify(authenticatedBody),
        }

        // Make the actual request
        const response = await fetch(input, authenticatedInit)

        // Clone response for reading (original can still be returned)
        const responseClone = response.clone()

        try {
          // Parse response JSON to capture signature
          const responseData = (await responseClone.json()) as ChatCompletionResponse

          // Capture for verification (strip auth fields from request before storing)
          const requestForCapture: ChatCompletionRequest = {
            messages: (originalBody.messages as ChatCompletionRequest['messages']) || [],
            model: (originalBody.model as string) || '',
            grantMessage: '',
            grantSignature: '',
            walletAddress: '',
          }

          captureRequestResponse(requestForCapture, responseData)
        } catch {
          // Non-JSON response or parse error - skip capture
        }

        return response
      } catch (error) {
        // If JSON parsing fails, pass through unmodified
        console.warn('Failed to process EigenAI request:', error)
        return fetch(input, init)
      }
    }

    // Pass through non-POST requests
    return fetch(input, init)
  }

  return customFetch
}

/**
 * Check if EigenAI is enabled
 *
 * @returns Whether EigenAI is the current inference provider
 */
export function isEigenAIEnabled(): boolean {
  return EIGENAI_CONFIG.enabled
}

/**
 * Get EigenAI configuration summary (safe for logging)
 *
 * @returns Configuration summary without sensitive values
 */
export function getEigenAIConfigSummary(): {
  enabled: boolean
  apiUrl: string
  modelId: string
  chainId: string
  expectedSigner: string
  recallEnabled: boolean
} {
  return {
    enabled: EIGENAI_CONFIG.enabled,
    apiUrl: EIGENAI_CONFIG.apiUrl,
    modelId: EIGENAI_CONFIG.modelId,
    chainId: EIGENAI_CONFIG.chainId,
    expectedSigner: EIGENAI_CONFIG.expectedSigner,
    recallEnabled: EIGENAI_CONFIG.recallEnabled,
  }
}
