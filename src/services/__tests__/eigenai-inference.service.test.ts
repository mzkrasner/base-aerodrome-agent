/**
 * EigenAI Inference Service Integration Test
 *
 * Tests that real EigenAI inference data is saved to the database.
 * Requires: LLM_PROVIDER=eigenai and EIGENAI_API_KEY or EIGENAI_PRIVATE_KEY
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { aerodromeAgent } from '../../agents/trading.agent'
import { db } from '../../database/db'
import { eigenaiInferences } from '../../database/schema/eigenai/defs'
import { initializeEigenAIInferenceTracking } from '../eigen/eigenai-inference.service'

const isEigenAI = process.env.LLM_PROVIDER === 'eigenai'
const hasAuth = !!(process.env.EIGENAI_API_KEY || process.env.EIGENAI_PRIVATE_KEY)

describe.skipIf(!isEigenAI || !hasAuth)('EigenAI Inference Persistence', () => {
  beforeEach(async () => {
    // Clear test data before each test
    await db.delete(eigenaiInferences)
  })

  it('saves qwen reasoning inference to database', async () => {
    // Initialize tracking (sets up the callback)
    initializeEigenAIInferenceTracking()

    // Get count before
    const beforeInferences = await db.select().from(eigenaiInferences)
    expect(beforeInferences.length).toBe(0)

    // Make a real EigenAI call through the agent
    await aerodromeAgent.generate('What is the current price of WETH? Use your tools.', {
      maxSteps: 10,
    })

    // Query the database directly
    const afterInferences = await db.select().from(eigenaiInferences)

    console.log(`Inferences saved: ${afterInferences.length}`)

    // Should have saved exactly one inference (the qwen reasoning decision)
    expect(afterInferences.length).toBe(1)

    const qwenInference = afterInferences[0]

    // Verify it's the qwen model
    expect(qwenInference.responseModel).toContain('qwen')

    // Verify signature exists
    expect(qwenInference.signature).toBeDefined()
    expect(qwenInference.signature.length).toBeGreaterThan(0)

    // Verify response has reasoning (trading decision JSON)
    expect(qwenInference.responseOutput).toContain('reasoning')

    // Verify not yet submitted to Recall
    expect(qwenInference.submittedToRecall).toBe(false)

    console.log('✅ Qwen inference saved:')
    console.log('   Model:', qwenInference.responseModel)
    console.log('   Signature:', qwenInference.signature.substring(0, 30) + '...')
    console.log('   Output preview:', qwenInference.responseOutput.substring(0, 100) + '...')
  }, 120000)
})
