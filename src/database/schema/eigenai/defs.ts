/**
 * EigenAI Verifiable Inference Schema
 *
 * Stores cryptographic signatures from EigenAI inference calls for:
 * - Audit trail (prove which LLM made which decision)
 * - Competition submission (batch-submit to Recall API later)
 * - Debugging (see exactly what the model was asked/answered)
 *
 * NOTE: This app does NOT verify signatures locally.
 * Verification happens on the Recall API when we submit.
 *
 * Reference: js-recall/packages/db/src/schema/eigenai/
 */
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { swapTransactions } from '../trading/defs'
import { timestampColumns, uuidColumn } from '../util'

/**
 * EigenAI Inferences
 *
 * Immutable log of all EigenAI inference calls with signature data.
 * Each row represents one EigenAI API call by the agent.
 * Rows are append-only (never updated after initial insert, except submission tracking).
 *
 * Data stored enables submission to Recall API:
 *   POST /api/eigenai/signatures
 *   { competitionId, requestPrompt, responseModel, responseOutput, signature }
 */
export const eigenaiInferences = pgTable(
  'eigenai_inferences',
  {
    id: uuidColumn(),

    // What was asked (concatenated prompt content)
    requestPrompt: text('request_prompt').notNull(),

    // What came back
    responseModel: text('response_model').notNull(), // e.g., "gpt-oss-120b-f16"
    responseOutput: text('response_output').notNull(),

    // Cryptographic signature from EigenAI (65-byte hex)
    signature: text('signature').notNull(),

    // Token usage
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),

    // Optional: Link to trading decision (if inference led to a swap)
    swapTransactionId: uuid('swap_transaction_id').references(() => swapTransactions.id),

    // Recall API submission tracking
    submittedToRecall: boolean('submitted_to_recall').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    recallSubmissionId: uuid('recall_submission_id'), // ID returned from Recall API

    // When the inference was made
    inferredAt: timestamp('inferred_at', { withTimezone: true }).notNull().defaultNow(),

    ...timestampColumns(),
  },
  (table) => [
    // Query unsubmitted inferences for batch submission
    index('idx_eigenai_submitted').on(table.submittedToRecall),

    // Query by time for batch submission
    index('idx_eigenai_inferred_at').on(table.inferredAt),

    // Query by linked swap
    index('idx_eigenai_swap_transaction').on(table.swapTransactionId),
  ]
)
