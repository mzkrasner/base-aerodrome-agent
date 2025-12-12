/**
 * Recall API Types
 *
 * Type definitions for the Recall EigenAI verification API.
 * @see https://docs.recall.ai/api/eigenai
 */

// =============================================================================
// Request Types
// =============================================================================

/**
 * Parameters for submitting an EigenAI signature for verification
 */
export interface RecallSubmitSignatureParams {
  /** Competition UUID the agent is participating in */
  competitionId: string
  /** Concatenated content from all request messages sent to EigenAI */
  requestPrompt: string
  /** Model ID from the EigenAI response (e.g., "qwen3-32b-128k-bf16") */
  responseModel: string
  /** Full output content from the EigenAI response */
  responseOutput: string
  /** 65-byte hex signature from the EigenAI response (with or without 0x prefix) */
  signature: string
}

/**
 * Parameters for getting submission history
 */
export interface RecallGetSubmissionsParams {
  /** Maximum number of submissions to return (1-100, default 50) */
  limit?: number
  /** Number of submissions to skip (default 0) */
  offset?: number
  /** Filter by verification status */
  status?: RecallVerificationStatus
}

// =============================================================================
// Response Types
// =============================================================================

/** Verification status for an EigenAI signature submission */
export type RecallVerificationStatus = 'verified' | 'invalid' | 'pending'

/**
 * Base API response
 */
export interface RecallApiResponse {
  success: boolean
}

/**
 * Error response from Recall API
 */
export interface RecallErrorResponse extends RecallApiResponse {
  success: false
  error: string
  status?: number
}

/**
 * Badge status information
 */
export interface RecallBadgeStatus {
  /** Whether the agent has an active EigenAI badge */
  isBadgeActive: boolean
  /** Number of verified signatures in the last 24 hours */
  signaturesLast24h: number
  /** Timestamp of the last verified signature, or null if none */
  lastVerifiedAt: string | null
}

/**
 * Response from POST /api/eigenai/signatures
 */
export interface RecallSubmitSignatureResponse extends RecallApiResponse {
  success: true
  /** UUID of the stored submission */
  submissionId: string
  /** Whether the signature was successfully verified */
  verified: boolean
  /** Verification status of the submission */
  verificationStatus: RecallVerificationStatus
  /** Current badge status after this submission */
  badgeStatus: RecallBadgeStatus
}

/**
 * Response from GET /api/eigenai/badge
 */
export interface RecallBadgeStatusResponse extends RecallApiResponse {
  success: true
  /** Agent UUID */
  agentId: string
  /** Competition UUID */
  competitionId: string
  /** Whether the agent has an active EigenAI badge */
  isBadgeActive: boolean
  /** Number of verified signatures in the last 24 hours */
  signaturesLast24h: number
  /** Timestamp of the last verified signature, or null if none */
  lastVerifiedAt: string | null
}

/**
 * Summary of a signature submission (returned in submissions list)
 */
export interface RecallSubmissionSummary {
  /** Submission UUID */
  id: string
  /** Verification status */
  verificationStatus: RecallVerificationStatus
  /** When the submission was created */
  submittedAt: string
  /** Model ID used for the inference */
  modelId: string
}

/**
 * Pagination information
 */
export interface RecallPagination {
  /** Total number of submissions */
  total: number
  /** Maximum results per page */
  limit: number
  /** Current offset */
  offset: number
  /** Whether there are more results */
  hasMore: boolean
}

/**
 * Response from GET /api/eigenai/submissions
 */
export interface RecallSubmissionsResponse extends RecallApiResponse {
  success: true
  /** Agent UUID */
  agentId: string
  /** Competition UUID */
  competitionId: string
  /** List of submission summaries */
  submissions: RecallSubmissionSummary[]
  /** Pagination information */
  pagination: RecallPagination
}

/**
 * Response from GET /api/eigenai/competitions/:id/stats (public endpoint)
 */
export interface RecallCompetitionStatsResponse extends RecallApiResponse {
  success: true
  /** Competition UUID */
  competitionId: string
  /** Total number of agents who have submitted signatures */
  totalAgentsWithSubmissions: number
  /** Number of agents with currently active EigenAI badges */
  agentsWithActiveBadge: number
  /** Total number of verified signatures for this competition */
  totalVerifiedSignatures: number
}
