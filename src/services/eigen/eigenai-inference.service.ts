/**
 * EigenAI Inference Service
 *
 * Saves verification data from EigenAI inference calls to the database.
 * This data can later be batch-submitted to the Recall API for verification.
 */
import { desc, eq, inArray } from 'drizzle-orm'

import { db } from '../../database/db.js'
import { eigenaiInferences } from '../../database/schema/index.js'
import { setEigenAIVerificationCallback } from '../../lib/llm/index.js'
import type { EigenAIVerificationData } from '../../lib/llm/types.js'

/**
 * EigenAI Inference Tracker
 *
 * Manages saving and querying EigenAI inference records.
 */
export class EigenAIInferenceTracker {
  /**
   * Save verification data to database
   */
  async saveInference(data: EigenAIVerificationData): Promise<string> {
    const [result] = await db
      .insert(eigenaiInferences)
      .values({
        requestPrompt: data.requestPrompt,
        responseModel: data.responseModel,
        responseOutput: data.responseOutput,
        signature: data.signature,
        promptTokens: data.usage.promptTokens,
        completionTokens: data.usage.completionTokens,
        totalTokens: data.usage.totalTokens,
        submittedToRecall: false,
      })
      .returning({ id: eigenaiInferences.id })

    console.log(`[EigenAI] Saved inference to database: ${result.id}`)
    return result.id
  }

  /**
   * Get unsubmitted inferences for batch submission to Recall
   */
  async getUnsubmittedInferences(limit = 100) {
    return db
      .select()
      .from(eigenaiInferences)
      .where(eq(eigenaiInferences.submittedToRecall, false))
      .limit(limit)
      .orderBy(eigenaiInferences.inferredAt)
  }

  /**
   * Get the most recent unsubmitted inference
   *
   * Used for periodic submission to Recall (1 per 15 minutes)
   * @returns The most recent unsubmitted inference, or null if none
   */
  async getMostRecentUnsubmitted() {
    const [result] = await db
      .select()
      .from(eigenaiInferences)
      .where(eq(eigenaiInferences.submittedToRecall, false))
      .orderBy(desc(eigenaiInferences.inferredAt))
      .limit(1)
    return result ?? null
  }

  /**
   * Mark inferences as submitted to Recall
   */
  async markSubmitted(ids: string[], recallSubmissionId?: string): Promise<void> {
    await db
      .update(eigenaiInferences)
      .set({
        submittedToRecall: true,
        submittedAt: new Date(),
        recallSubmissionId: recallSubmissionId ?? null,
      })
      .where(inArray(eigenaiInferences.id, ids))

    console.log(`[EigenAI] Marked ${ids.length} inferences as submitted to Recall`)
  }

  /**
   * Get inference by ID
   */
  async getById(id: string) {
    const [result] = await db
      .select()
      .from(eigenaiInferences)
      .where(eq(eigenaiInferences.id, id))
      .limit(1)
    return result ?? null
  }

  /**
   * Initialize inference tracking
   *
   * Sets up the global callback to automatically save verification data.
   * Call once at app startup.
   */
  initialize(): void {
    setEigenAIVerificationCallback(async (data) => {
      try {
        await this.saveInference(data)
      } catch (error) {
        console.error('[EigenAI] Failed to save inference to database:', error)
        // Don't throw - we don't want to break inference if DB save fails
      }
    })
    console.log('[EigenAI] Inference tracking initialized')
  }
}

// Singleton instance
export const eigenaiInferenceTracker = new EigenAIInferenceTracker()

/**
 * Initialize EigenAI inference tracking.
 * Convenience function that calls the singleton's initialize method.
 */
export function initializeEigenAIInferenceTracking(): void {
  eigenaiInferenceTracker.initialize()
}
