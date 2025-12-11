/**
 * TypeScript types derived from EigenAI Drizzle schema
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import type { eigenaiInferences } from './defs'

// EigenAI Inferences
export type EigenaiInference = InferSelectModel<typeof eigenaiInferences>
export type NewEigenaiInference = InferInsertModel<typeof eigenaiInferences>

/**
 * Data captured from EigenAI response for Recall submission
 * This is what we store locally and later submit to Recall API
 */
export interface EigenAIInferenceData {
  /** Concatenated prompt content from all request messages */
  requestPrompt: string
  /** Model ID from EigenAI response (e.g., "gpt-oss-120b-f16") */
  responseModel: string
  /** Full output content from EigenAI response */
  responseOutput: string
  /** 65-byte hex signature from EigenAI */
  signature: string
  /** Token usage from the response */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Payload for submitting to Recall API
 * POST /api/eigenai/signatures
 */
export interface RecallSignatureSubmission {
  /** Competition ID the agent is participating in */
  competitionId: string
  /** Concatenated content from all request messages sent to EigenAI */
  requestPrompt: string
  /** Model ID from the EigenAI response */
  responseModel: string
  /** Full output content from the EigenAI response */
  responseOutput: string
  /** 65-byte hex signature from the EigenAI response */
  signature: string
}

/**
 * Response from Recall API signature submission
 */
export interface RecallSignatureResponse {
  success: boolean
  submissionId: string
  verified: boolean
  verificationStatus: 'verified' | 'invalid' | 'pending'
  badgeStatus?: {
    isBadgeActive: boolean
    signaturesLast24h: number
  }
}
