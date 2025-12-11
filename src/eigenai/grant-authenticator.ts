/**
 * Grant Authentication for dTERMinal API
 *
 * Handles the grant-based authentication flow for EigenAI's dTERMinal API:
 * 1. Fetch grant message from API
 * 2. Sign message with grant wallet
 * 3. Cache signed grant for reuse
 * 4. Detect expiry and renew as needed
 *
 * @module eigenai/grant-authenticator
 */

import { ethers } from 'ethers'

import { EIGENAI_CONFIG } from '../config/eigenai.js'
import type { CachedGrant, GrantCheckResponse, GrantMessageResponse } from './types.js'

/**
 * Singleton instance for grant authentication
 *
 * Caches grant signatures to avoid repeated signing on every API call.
 */
class GrantAuthenticator {
  private cachedGrant: CachedGrant | null = null
  private wallet: ethers.Wallet | null = null

  /**
   * Initialize the grant wallet
   *
   * Creates an ethers Wallet instance from the configured private key.
   * This wallet is used only for signing grant messages, NOT for trading.
   *
   * @throws {Error} If EIGENAI_GRANT_PRIVATE_KEY is not configured
   */
  private initializeWallet(): ethers.Wallet {
    if (this.wallet) {
      return this.wallet
    }

    if (!EIGENAI_CONFIG.grantWalletPrivateKey) {
      throw new Error(
        'EIGENAI_GRANT_PRIVATE_KEY is required for grant authentication. ' +
          'Set it in your .env file.'
      )
    }

    try {
      this.wallet = new ethers.Wallet(EIGENAI_CONFIG.grantWalletPrivateKey)
      return this.wallet
    } catch (error) {
      throw new Error(
        `Failed to initialize grant wallet: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          'Check that EIGENAI_GRANT_PRIVATE_KEY is a valid 0x-prefixed hex string.'
      )
    }
  }

  /**
   * Get the grant wallet address
   *
   * @returns {string} The wallet address (0x-prefixed)
   */
  getWalletAddress(): string {
    const wallet = this.initializeWallet()
    return wallet.address
  }

  /**
   * Fetch grant message from dTERMinal API
   *
   * Calls GET /message?address=<wallet> to get the message that must be signed.
   *
   * @returns {Promise<GrantMessageResponse>} The grant message to sign
   * @throws {Error} If API request fails
   */
  private async fetchGrantMessage(): Promise<GrantMessageResponse> {
    const walletAddress = this.getWalletAddress()
    const url = `${EIGENAI_CONFIG.apiUrl}/message?address=${walletAddress}`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to fetch grant message: ${response.status} - ${text}`)
      }

      return (await response.json()) as GrantMessageResponse
    } catch (error) {
      throw new Error(
        `Failed to fetch grant message from ${url}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Check current grant status
   *
   * Calls GET /checkGrant?address=<wallet> to see if wallet has an active grant.
   * Useful for monitoring grant token usage.
   *
   * @returns {Promise<GrantCheckResponse>} Grant status and remaining tokens
   */
  async checkGrantStatus(): Promise<GrantCheckResponse> {
    const walletAddress = this.getWalletAddress()
    const url = `${EIGENAI_CONFIG.apiUrl}/checkGrant?address=${walletAddress}`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Failed to check grant status: ${response.status} - ${text}`)
      }

      return (await response.json()) as GrantCheckResponse
    } catch (error) {
      throw new Error(
        `Failed to check grant status from ${url}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    }
  }

  /**
   * Sign the grant message
   *
   * Uses the grant wallet to sign the message with ECDSA.
   *
   * @param {string} message - The message to sign
   * @returns {Promise<string>} The signature (0x-prefixed 65-byte hex string)
   */
  private async signMessage(message: string): Promise<string> {
    const wallet = this.initializeWallet()

    try {
      return await wallet.signMessage(message)
    } catch (error) {
      throw new Error(
        `Failed to sign grant message: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Get or renew cached grant
   *
   * Returns a cached grant signature if available and valid.
   * If no cached grant exists or it appears expired, fetches and signs a new grant.
   *
   * **Expiry Detection**:
   * - Grants are cached for up to 1 hour
   * - If API returns an authentication error, grant is refreshed automatically
   *
   * @param {boolean} forceRefresh - Force fetching a new grant even if cached
   * @returns {Promise<CachedGrant>} The grant signature data
   */
  async getOrRenewGrant(forceRefresh = false): Promise<CachedGrant> {
    // Return cached grant if valid
    if (this.cachedGrant && !forceRefresh && this.isGrantValid(this.cachedGrant)) {
      return this.cachedGrant
    }

    // Fetch new grant message
    const grantMessageResponse = await this.fetchGrantMessage()

    // Sign the message
    const signature = await this.signMessage(grantMessageResponse.message)

    // Check grant status for token monitoring
    let remainingTokens: number | undefined

    try {
      const grantStatus = await this.checkGrantStatus()
      remainingTokens = grantStatus.grant?.remainingTokens
    } catch (error) {
      // Non-critical - continue without token count
      console.warn('Could not check grant status:', error)
    }

    // Cache the signed grant
    this.cachedGrant = {
      message: grantMessageResponse.message,
      signature,
      walletAddress: this.getWalletAddress(),
      cachedAt: new Date(),
      remainingTokens,
    }

    // Log grant status
    if (remainingTokens !== undefined) {
      console.log(
        `✅ Grant authenticated (${remainingTokens.toLocaleString()} tokens remaining)`
      )
    } else {
      console.log('✅ Grant authenticated')
    }

    return this.cachedGrant
  }

  /**
   * Check if a cached grant is still valid
   *
   * Grants are considered valid if:
   * - Cached less than 1 hour ago
   * - Have remaining tokens (if known)
   *
   * @param {CachedGrant} grant - The cached grant to check
   * @returns {boolean} Whether the grant is still valid
   */
  private isGrantValid(grant: CachedGrant): boolean {
    const now = Date.now()
    const cachedAge = now - grant.cachedAt.getTime()
    const oneHourInMs = 60 * 60 * 1000

    // Grant is too old (> 1 hour)
    if (cachedAge > oneHourInMs) {
      return false
    }

    // Grant has no tokens remaining (if we know the count)
    if (grant.remainingTokens !== undefined && grant.remainingTokens <= 0) {
      return false
    }

    return true
  }

  /**
   * Clear cached grant
   *
   * Forces a fresh grant fetch on the next API call.
   * Useful if you suspect the grant has expired or been revoked.
   */
  clearCache(): void {
    this.cachedGrant = null
  }

  /**
   * Get authentication fields for chat completion request
   *
   * Returns the grant authentication fields that must be included
   * in the request body for dTERMinal API calls.
   *
   * @param {boolean} forceRefresh - Force fetching a new grant
   * @returns {Promise<{grantMessage: string, grantSignature: string, walletAddress: string}>}
   */
  async getAuthenticationFields(forceRefresh = false): Promise<{
    grantMessage: string
    grantSignature: string
    walletAddress: string
  }> {
    const grant = await this.getOrRenewGrant(forceRefresh)

    return {
      grantMessage: grant.message,
      grantSignature: grant.signature,
      walletAddress: grant.walletAddress,
    }
  }
}

/**
 * Singleton instance of GrantAuthenticator
 *
 * Use this instance throughout the application to maintain grant cache.
 */
export const grantAuthenticator = new GrantAuthenticator()

/**
 * Convenience function to get authentication fields
 *
 * Wrapper around the singleton instance for easy imports.
 *
 * @param {boolean} forceRefresh - Force fetching a new grant
 * @returns {Promise<{grantMessage: string, grantSignature: string, walletAddress: string}>}
 *
 * @example
 * ```typescript
 * const auth = await getAuthenticationFields()
 * const request = {
 *   messages: [...],
 *   model: 'gpt-oss-120b-f16',
 *   ...auth // Adds grantMessage, grantSignature, walletAddress
 * }
 * ```
 */
export async function getAuthenticationFields(
  forceRefresh = false
): Promise<{
  grantMessage: string
  grantSignature: string
  walletAddress: string
}> {
  return grantAuthenticator.getAuthenticationFields(forceRefresh)
}

/**
 * Check grant status
 *
 * Convenience function to check current grant status and remaining tokens.
 *
 * @returns {Promise<GrantCheckResponse>} Grant status
 */
export async function checkGrantStatus(): Promise<GrantCheckResponse> {
  return grantAuthenticator.checkGrantStatus()
}

/**
 * Clear cached grant
 *
 * Convenience function to clear the grant cache.
 */
export function clearGrantCache(): void {
  grantAuthenticator.clearCache()
}
