/**
 * EigenAI Module
 *
 * Provides integration with EigenAI's dTERMinal API for verifiable AI inference.
 * Includes grant authentication, signature verification, and response capture.
 *
 * @module eigenai
 *
 * @example
 * ```typescript
 * import {
 *   isEigenAIEnabled,
 *   processAndVerifyLastResponse,
 *   verifyEigenAISignature,
 * } from './eigenai/index.js'
 *
 * // Check if EigenAI is the current provider
 * if (isEigenAIEnabled()) {
 *   // Process signature after agent generates response
 *   const submission = await processAndVerifyLastResponse(iterationNumber)
 * }
 * ```
 */

export * from './types.js'
export * from './grant-authenticator.js'
export * from './signature-verifier.js'
export * from './client.js'
