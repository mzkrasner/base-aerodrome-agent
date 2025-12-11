/**
 * Recall Wallet Verification Service
 *
 * Handles one-time wallet verification with the Recall API.
 * This proves that the agent controls the private key for its trading wallet.
 *
 * Flow:
 * 1. Fetch a unique verification nonce from Recall API
 * 2. Create and sign a verification message with the trading wallet
 * 3. Submit the signed message to Recall API for verification
 *
 * The verification must be completed within 5 minutes of the timestamp.
 */

import { EIGENAI_CONFIG } from '../config/eigenai.js'
import { getWallet, getWalletAddress } from '../execution/wallet.js'

/**
 * Result of wallet verification operation
 */
export interface VerificationResult {
  success: boolean
  walletAddress?: string
  error?: string
}

/**
 * Response from the nonce endpoint
 */
interface NonceResponse {
  nonce: string
}

/**
 * Response from the verification endpoint
 */
interface VerifyResponse {
  success: boolean
  walletAddress?: string
  message?: string
  error?: string
}

/**
 * Fetch a unique verification nonce from Recall API
 *
 * @returns Nonce string or error
 * @private
 */
async function fetchNonce(): Promise<{ success: boolean; nonce?: string; error?: string }> {
  try {
    const response = await fetch(`${EIGENAI_CONFIG.recallApiUrl}/api/auth/agent/nonce`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${EIGENAI_CONFIG.recallApiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Failed to fetch nonce: ${response.status} - ${errorText}`,
      }
    }

    const data = (await response.json()) as NonceResponse

    if (!data.nonce) {
      return {
        success: false,
        error: 'Invalid nonce response: missing nonce field',
      }
    }

    return {
      success: true,
      nonce: data.nonce,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Network error while fetching nonce: ${errorMessage}`,
    }
  }
}

/**
 * Create and sign a verification message with the trading wallet
 *
 * Message format (must be exact):
 * VERIFY_WALLET_OWNERSHIP
 * Timestamp: {ISO 8601 timestamp}
 * Domain: {Recall API URL}
 * Purpose: WALLET_VERIFICATION
 * Nonce: {nonce from API}
 *
 * @param nonce - Unique nonce from Recall API
 * @returns Signed message data or error
 * @private
 */
async function signVerificationMessage(
  nonce: string
): Promise<{
  success: boolean
  message?: string
  signature?: string
  walletAddress?: string
  error?: string
}> {
  try {
    const wallet = getWallet()
    const walletAddress = wallet.address
    const timestamp = new Date().toISOString()

    // Create message in exact format required by Recall API
    const message = `VERIFY_WALLET_OWNERSHIP
Timestamp: ${timestamp}
Domain: ${EIGENAI_CONFIG.recallApiUrl}
Purpose: WALLET_VERIFICATION
Nonce: ${nonce}`

    // Sign message with trading wallet
    const signature = await wallet.signMessage(message)

    return {
      success: true,
      message,
      signature,
      walletAddress,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Failed to sign message: ${errorMessage}`,
    }
  }
}

/**
 * Submit verification to Recall API
 *
 * @param message - The verification message
 * @param signature - The signed message
 * @returns Verification result
 * @private
 */
async function submitVerification(
  message: string,
  signature: string
): Promise<VerificationResult> {
  try {
    const response = await fetch(`${EIGENAI_CONFIG.recallApiUrl}/api/auth/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${EIGENAI_CONFIG.recallApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, signature }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Verification failed: ${response.status} - ${errorText}`,
      }
    }

    const data = (await response.json()) as VerifyResponse

    if (!data.success) {
      return {
        success: false,
        error: data.error || data.message || 'Verification failed',
      }
    }

    return {
      success: true,
      walletAddress: data.walletAddress,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Network error during verification: ${errorMessage}`,
    }
  }
}

/**
 * Verify wallet ownership with Recall API
 *
 * This is a ONE-TIME operation that proves the agent controls its trading wallet.
 * The Recall API will then use its blockchain indexer to monitor the agent's
 * onchain trading performance.
 *
 * Flow:
 * 1. GET nonce from /api/auth/agent/nonce
 * 2. Sign verification message with trading wallet (AGENT_PRIVATE_KEY)
 * 3. POST signature to /api/auth/verify
 *
 * The verification must be completed within 5 minutes of the timestamp.
 *
 * @returns VerificationResult with success status and wallet address or error
 */
export async function verifyWalletOwnership(): Promise<VerificationResult> {
  // Step 1: Fetch nonce
  console.log('🔄 Fetching verification nonce...')
  const nonceResult = await fetchNonce()

  if (!nonceResult.success || !nonceResult.nonce) {
    return {
      success: false,
      error: nonceResult.error || 'Failed to fetch nonce',
    }
  }

  console.log('✅ Nonce received\n')

  // Step 2: Sign message
  console.log('🔄 Signing verification message...')
  const signResult = await signVerificationMessage(nonceResult.nonce)

  if (!signResult.success || !signResult.message || !signResult.signature) {
    return {
      success: false,
      error: signResult.error || 'Failed to sign message',
    }
  }

  console.log('✅ Message signed\n')

  // Step 3: Submit verification
  console.log('🔄 Submitting verification to Recall API...')
  const verifyResult = await submitVerification(signResult.message, signResult.signature)

  if (!verifyResult.success) {
    return verifyResult
  }

  return {
    success: true,
    walletAddress: verifyResult.walletAddress || signResult.walletAddress,
  }
}
