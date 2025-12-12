/**
 * Recall API Client
 *
 * Client for interacting with the Recall EigenAI verification API.
 * Handles authentication and provides typed methods for all endpoints.
 */
import { RECALL_CONFIG } from '../../config/index.js'
import type {
  RecallBadgeStatusResponse,
  RecallCompetitionStatsResponse,
  RecallErrorResponse,
  RecallGetSubmissionsParams,
  RecallSubmissionsResponse,
  RecallSubmitSignatureParams,
  RecallSubmitSignatureResponse,
} from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a Recall client
 */
export interface RecallClientOptions {
  /** Recall API base URL (defaults to RECALL_API_URL env var) */
  apiUrl?: string
  /** Recall API key for agent authentication (defaults to RECALL_API_KEY env var) */
  apiKey?: string
}

/**
 * Result type for API operations
 */
export type RecallResult<T> =
  | { success: true; data: T }
  | { success: false; error: RecallErrorResponse }

// =============================================================================
// Client Implementation
// =============================================================================

/**
 * Recall API Client
 *
 * Provides methods for submitting EigenAI signatures and querying badge status.
 *
 * @example
 * ```typescript
 * const client = new RecallClient()
 *
 * const result = await client.submitSignature({
 *   competitionId: 'uuid',
 *   requestPrompt: 'Based on market data...',
 *   responseModel: 'qwen3-32b-128k-bf16',
 *   responseOutput: '{"reasoning": "...", "trade_decisions": [...]}',
 *   signature: '0x...',
 * })
 *
 * if (result.success) {
 *   console.log('Submitted:', result.data.submissionId)
 * }
 * ```
 */
export class RecallClient {
  private readonly apiUrl: string
  private readonly apiKey: string

  constructor(options: RecallClientOptions = {}) {
    this.apiUrl = options.apiUrl ?? RECALL_CONFIG.apiUrl
    this.apiKey = options.apiKey ?? RECALL_CONFIG.apiKey

    if (!this.apiUrl) {
      throw new Error('Recall API URL is required. Set RECALL_API_URL environment variable.')
    }
    if (!this.apiKey) {
      throw new Error('Recall API key is required. Set RECALL_API_KEY environment variable.')
    }
  }

  /**
   * Build headers for authenticated requests
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  /**
   * Make an API request and handle errors
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<RecallResult<T>> {
    const url = `${this.apiUrl}${path}`

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      })

      const data = (await response.json()) as T | RecallErrorResponse

      if (!response.ok) {
        const errorData = data as RecallErrorResponse
        return {
          success: false,
          error: {
            success: false,
            error: errorData.error ?? `HTTP ${response.status}`,
            status: response.status,
          },
        }
      }

      return { success: true, data: data as T }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        error: {
          success: false,
          error: `Network error: ${message}`,
          status: 0,
        },
      }
    }
  }

  /**
   * Submit an EigenAI signature for verification
   *
   * @param params - Signature submission parameters
   * @returns Submission result with verification status and badge info
   */
  async submitSignature(
    params: RecallSubmitSignatureParams
  ): Promise<RecallResult<RecallSubmitSignatureResponse>> {
    return this.request<RecallSubmitSignatureResponse>('POST', '/api/eigenai/signatures', params)
  }

  /**
   * Get badge status for the authenticated agent
   *
   * @param competitionId - Competition UUID to check badge status for
   * @returns Badge status including active status and signature count
   */
  async getBadgeStatus(competitionId: string): Promise<RecallResult<RecallBadgeStatusResponse>> {
    const encodedId = encodeURIComponent(competitionId)
    return this.request<RecallBadgeStatusResponse>(
      'GET',
      `/api/eigenai/badge?competitionId=${encodedId}`
    )
  }

  /**
   * Get signature submission history for the authenticated agent
   *
   * @param competitionId - Competition UUID to get submissions for
   * @param params - Optional pagination and filter parameters
   * @returns Paginated list of submission summaries
   */
  async getSubmissions(
    competitionId: string,
    params?: RecallGetSubmissionsParams
  ): Promise<RecallResult<RecallSubmissionsResponse>> {
    const queryParams = new URLSearchParams()
    queryParams.append('competitionId', competitionId)

    if (params?.limit !== undefined) {
      queryParams.append('limit', params.limit.toString())
    }
    if (params?.offset !== undefined) {
      queryParams.append('offset', params.offset.toString())
    }
    if (params?.status) {
      queryParams.append('status', params.status)
    }

    return this.request<RecallSubmissionsResponse>(
      'GET',
      `/api/eigenai/submissions?${queryParams.toString()}`
    )
  }

  /**
   * Get EigenAI statistics for a competition (public endpoint)
   *
   * Note: This endpoint does not require authentication.
   *
   * @param competitionId - Competition UUID to get stats for
   * @returns Competition-wide EigenAI statistics
   */
  async getCompetitionStats(
    competitionId: string
  ): Promise<RecallResult<RecallCompetitionStatsResponse>> {
    const encodedId = encodeURIComponent(competitionId)
    return this.request<RecallCompetitionStatsResponse>(
      'GET',
      `/api/eigenai/competitions/${encodedId}/stats`
    )
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.apiUrl && this.apiKey)
  }
}

/**
 * Create a Recall client with default configuration from environment
 *
 * @returns RecallClient instance or null if not configured
 */
export function createRecallClient(): RecallClient | null {
  if (!RECALL_CONFIG.apiUrl || !RECALL_CONFIG.apiKey) {
    return null
  }
  return new RecallClient()
}
