/**
 * Twitter Sentiment Tool - Integration Test
 * Calls actual Grok API with X/Twitter live search
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('Twitter Sentiment Tool - Retry Logic', () => {
  const originalFetch = global.fetch
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
    // Ensure API key is set for these tests
    process.env.GROK_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  /** Helper to create a successful Grok API response */
  const createSuccessResponse = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                observations: { AERO: { post_themes: ['bullish'] } },
                search_metadata: { posts_analyzed: 10 },
              }),
            },
          },
        ],
        citations: ['https://x.com/example'],
      }),
      { status: 200 }
    )

  /** Helper to create an error response */
  const createErrorResponse = (status: number) =>
    new Response(
      JSON.stringify({
        error: { message: `Server error ${status}` },
      }),
      { status }
    )

  it('retries on 500 server error and succeeds', async () => {
    // First call fails with 500, second succeeds
    mockFetch
      .mockResolvedValueOnce(createErrorResponse(500))
      .mockResolvedValueOnce(createSuccessResponse())

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 10000)

  it('retries on 429 rate limit and succeeds', async () => {
    // First call fails with 429, second succeeds
    mockFetch
      .mockResolvedValueOnce(createErrorResponse(429))
      .mockResolvedValueOnce(createSuccessResponse())

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 10000)

  it('retries on 502/503/504 gateway errors', async () => {
    // First two calls fail, third succeeds
    mockFetch
      .mockResolvedValueOnce(createErrorResponse(502))
      .mockResolvedValueOnce(createErrorResponse(503))
      .mockResolvedValueOnce(createSuccessResponse())

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 15000)

  it('fails after max retries (3 attempts)', async () => {
    // All calls fail with 500
    mockFetch
      .mockResolvedValueOnce(createErrorResponse(500))
      .mockResolvedValueOnce(createErrorResponse(500))
      .mockResolvedValueOnce(createErrorResponse(500))

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to fetch sentiment data')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 15000)

  it('does not retry on 400 client error', async () => {
    // 400 is not retryable
    mockFetch.mockResolvedValueOnce(createErrorResponse(400))

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('does not retry on 401 unauthorized', async () => {
    // 401 is not retryable
    mockFetch.mockResolvedValueOnce(createErrorResponse(401))

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('retries on network errors', async () => {
    // First call throws network error, second succeeds
    mockFetch
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(createSuccessResponse())

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  }, 10000)

  it('fails after max retries on persistent network errors', async () => {
    // All calls throw network errors
    mockFetch
      .mockRejectedValueOnce(new Error('Network error 1'))
      .mockRejectedValueOnce(new Error('Network error 2'))
      .mockRejectedValueOnce(new Error('Network error 3'))

    const result = await getSentiment(['AERO'])

    expect(result.success).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  }, 15000)
})
