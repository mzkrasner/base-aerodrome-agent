/**
 * Recall API Services
 *
 * Provides client and services for submitting EigenAI verified
 * signatures to the Recall API for badge verification.
 *
 * @module services/recall
 */

// Types
export type {
  RecallApiResponse,
  RecallBadgeStatus,
  RecallBadgeStatusResponse,
  RecallCompetitionStatsResponse,
  RecallErrorResponse,
  RecallGetSubmissionsParams,
  RecallPagination,
  RecallSubmissionsResponse,
  RecallSubmissionSummary,
  RecallSubmitSignatureParams,
  RecallSubmitSignatureResponse,
  RecallVerificationStatus,
} from './types.js'

// Client
export { RecallClient, createRecallClient } from './recall-client.js'
export type { RecallClientOptions, RecallResult } from './recall-client.js'

// Submission Service
export {
  initializeRecallSubmission,
  recallSubmissionService,
  RecallSubmissionService,
} from './recall-submission.service.js'
export type { RecallSubmissionServiceOptions } from './recall-submission.service.js'
