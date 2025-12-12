/**
 * Recall Submission Service
 *
 * Periodically submits the most recent EigenAI inference to Recall
 * for verification. Runs every 15 minutes when enabled.
 */
import { RECALL_CONFIG } from '../../config/index.js'
import { eigenaiInferenceTracker } from '../eigen/eigenai-inference.service.js'
import { type RecallClient, createRecallClient } from './recall-client.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the Recall submission service
 */
export interface RecallSubmissionServiceOptions {
  /** Custom Recall client (defaults to creating one from env) */
  client?: RecallClient
  /** Competition ID override (defaults to RECALL_COMPETITION_ID env var) */
  competitionId?: string
  /** Submission interval in ms (defaults to 15 minutes) */
  intervalMs?: number
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Recall Submission Service
 *
 * Manages periodic submission of EigenAI inferences to the Recall API.
 * Submits the most recent unsubmitted inference every 15 minutes.
 *
 * @example
 * ```typescript
 * const service = new RecallSubmissionService()
 *
 * // Start periodic submissions
 * service.start()
 *
 * // Stop when done
 * service.stop()
 *
 * // Or submit manually
 * const result = await service.submitMostRecent()
 * ```
 */
export class RecallSubmissionService {
  private readonly client: RecallClient | null
  private readonly competitionId: string
  private readonly intervalMs: number
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private isRunning = false

  constructor(options: RecallSubmissionServiceOptions = {}) {
    this.client = options.client ?? createRecallClient()
    this.competitionId = options.competitionId ?? RECALL_CONFIG.competitionId
    this.intervalMs = options.intervalMs ?? RECALL_CONFIG.submissionIntervalMs
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return this.client !== null && Boolean(this.competitionId)
  }

  /**
   * Submit the most recent unsubmitted inference to Recall
   *
   * @returns Submission result or null if nothing to submit or not configured
   */
  async submitMostRecent(): Promise<{
    success: boolean
    submissionId?: string
    verified?: boolean
    error?: string
  } | null> {
    if (!this.client) {
      console.log('[Recall] Not configured - skipping submission')
      return null
    }

    if (!this.competitionId) {
      console.warn('[Recall] No competition ID configured - skipping submission')
      return null
    }

    // Get most recent unsubmitted inference
    const inference = await eigenaiInferenceTracker.getMostRecentUnsubmitted()

    if (!inference) {
      console.log('[Recall] No unsubmitted inferences found')
      return null
    }

    console.log(`[Recall] Submitting inference ${inference.id} to Recall...`)

    const result = await this.client.submitSignature({
      competitionId: this.competitionId,
      requestPrompt: inference.requestPrompt,
      responseModel: inference.responseModel,
      responseOutput: inference.responseOutput,
      signature: inference.signature,
    })

    if (!result.success) {
      console.error(`[Recall] Submission failed: ${result.error.error}`)
      return {
        success: false,
        error: result.error.error,
      }
    }

    // Mark as submitted in our database
    await eigenaiInferenceTracker.markSubmitted([inference.id], result.data.submissionId)

    console.log(
      `[Recall] Submitted successfully: ${result.data.submissionId} (verified: ${result.data.verified})`
    )
    console.log(
      `[Recall] Badge status: ${result.data.badgeStatus.isBadgeActive ? 'ACTIVE' : 'inactive'} ` +
        `(${result.data.badgeStatus.signaturesLast24h} signatures in 24h)`
    )

    return {
      success: true,
      submissionId: result.data.submissionId,
      verified: result.data.verified,
    }
  }

  /**
   * Start periodic submission (every 15 minutes by default)
   */
  start(): void {
    if (!this.isConfigured()) {
      console.warn(
        '[Recall] Service not configured. Set RECALL_API_URL, RECALL_API_KEY, and RECALL_COMPETITION_ID.'
      )
      return
    }

    if (this.isRunning) {
      console.log('[Recall] Service already running')
      return
    }

    this.isRunning = true
    console.log(
      `[Recall] Starting submission service (interval: ${this.intervalMs / 60000} minutes)`
    )

    // Submit immediately on start
    void this.submitMostRecent()

    // Then submit periodically
    this.intervalHandle = setInterval(() => {
      void this.submitMostRecent()
    }, this.intervalMs)
  }

  /**
   * Stop periodic submission
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.isRunning = false
    console.log('[Recall] Submission service stopped')
  }

  /**
   * Get current badge status from Recall
   */
  async getBadgeStatus() {
    if (!this.client || !this.competitionId) {
      return null
    }
    return this.client.getBadgeStatus(this.competitionId)
  }
}

// =============================================================================
// Singleton & Initialization
// =============================================================================

/** Singleton instance */
export const recallSubmissionService = new RecallSubmissionService()

/**
 * Initialize and start Recall signature submission
 *
 * Call once at app startup to begin periodic submissions.
 * Only starts if properly configured (RECALL_API_URL, RECALL_API_KEY, RECALL_COMPETITION_ID).
 */
export function initializeRecallSubmission(): void {
  recallSubmissionService.start()
}
