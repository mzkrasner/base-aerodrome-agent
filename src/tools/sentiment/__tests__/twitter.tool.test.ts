/**
 * Twitter Sentiment Tool - Integration Test
 * Calls actual Grok API with X/Twitter live search
 */
import { describe, expect, it } from 'vitest'

import { getTwitterSentimentTool } from '../twitter.tool'

const getSentiment = (tokens: string[]) =>
  getTwitterSentimentTool.execute({
    context: { tokens },
    runtimeContext: {} as never,
  })

describe('Twitter Sentiment Tool', () => {
  it('returns structured observations for AERO', async () => {
    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // Observations should exist and be an object
    expect(result.observations).toBeDefined()
    expect(typeof result.observations).toBe('object')
    expect(Object.keys(result.observations).length).toBeGreaterThan(0)

    // Should contain AERO data or raw_summary
    const hasAeroKey = 'AERO' in result.observations
    const hasRawSummary = 'raw_summary' in result.observations
    expect(hasAeroKey || hasRawSummary).toBe(true)

    // If structured, verify expected fields exist
    if (hasAeroKey) {
      const aeroData = result.observations.AERO as Record<string, unknown>
      // Should have at least some of these observation fields
      const observationFields = [
        'post_themes',
        'sentiment_words',
        'volume_metrics',
        'sentiment_velocity',
        'whale_activity',
      ]
      const hasFields = observationFields.some((field) => field in aeroData)
      expect(hasFields).toBe(true)
    }

    console.log('AERO observations keys:', Object.keys(result.observations))
  }, 30000)

  it('returns citations as URLs', async () => {
    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(Array.isArray(result.citations)).toBe(true)

    // If citations exist, they should be URLs
    if (result.citations.length > 0) {
      result.citations.forEach((citation) => {
        expect(typeof citation).toBe('string')
        // Should look like a URL (http/https or x.com link)
        const isUrl =
          citation.startsWith('http') ||
          citation.includes('x.com') ||
          citation.includes('twitter.com')
        expect(isUrl).toBe(true)
      })
    }

    console.log('Citations count:', result.citations.length)
  }, 30000)

  it('returns search metadata with expected fields', async () => {
    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(result.searchMetadata).toBeDefined()
    expect(typeof result.searchMetadata).toBe('object')

    // Metadata should indicate something about the search
    const metaKeys = Object.keys(result.searchMetadata)
    expect(metaKeys.length).toBeGreaterThan(0)

    console.log('Search metadata:', result.searchMetadata)
  }, 30000)

  it('handles multiple tokens', async () => {
    const result = await getSentiment(['AERO', 'WETH'])

    expect(result.success).toBe(true)

    // Should have observations for the tokens or a combined summary
    const obsKeys = Object.keys(result.observations)
    expect(obsKeys.length).toBeGreaterThan(0)

    // Either separate keys for each token, or a combined response
    const hasMultipleTokenData =
      obsKeys.includes('AERO') || obsKeys.includes('WETH') || obsKeys.includes('raw_summary')
    expect(hasMultipleTokenData).toBe(true)

    console.log('Multi-token observation keys:', obsKeys)
  }, 30000)

  it('fails gracefully without API key', async () => {
    // Temporarily unset the key
    const originalKey = process.env.GROK_API_KEY
    delete process.env.GROK_API_KEY

    const result = await getSentiment(['AERO'])

    // Should fail gracefully
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('GROK_API_KEY')

    // Restore key
    process.env.GROK_API_KEY = originalKey
  })
})
