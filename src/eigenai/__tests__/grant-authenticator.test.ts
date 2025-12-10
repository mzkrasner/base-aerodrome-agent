/**
 * Grant Authenticator Tests
 *
 * Tests for the dTERMinal API grant authentication flow.
 */
import { Wallet } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/eigenai.js', () => ({
  EIGENAI_CONFIG: {
    enabled: true,
    apiUrl: 'https://test-api.example.com',
    modelId: 'gpt-oss-120b-f16',
    grantWalletPrivateKey: '',
    chainId: '1',
    expectedSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3',
    localVerificationEnabled: true,
    recallEnabled: false,
  },
}))

import { EIGENAI_CONFIG } from '../../config/eigenai.js'

class TestGrantAuthenticator {
  private cachedGrant: {
    message: string
    signature: string
    walletAddress: string
    cachedAt: Date
    remainingTokens?: number
  } | null = null
  private wallet: Wallet | null = null
  private privateKey: string

  constructor(privateKey: string) {
    this.privateKey = privateKey
  }

  private initializeWallet(): Wallet {
    if (this.wallet) {
      return this.wallet
    }

    if (!this.privateKey) {
      throw new Error(
        'EIGENAI_GRANT_PRIVATE_KEY is required for grant authentication. ' +
          'Set it in your .env file.'
      )
    }

    try {
      this.wallet = new Wallet(this.privateKey)
      return this.wallet
    } catch (error) {
      throw new Error(
        `Failed to initialize grant wallet: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          'Check that EIGENAI_GRANT_PRIVATE_KEY is a valid 0x-prefixed hex string.'
      )
    }
  }

  getWalletAddress(): string {
    const wallet = this.initializeWallet()
    return wallet.address
  }

  private async signMessage(message: string): Promise<string> {
    const wallet = this.initializeWallet()
    return await wallet.signMessage(message)
  }

  private isGrantValid(grant: { cachedAt: Date; remainingTokens?: number }): boolean {
    const now = Date.now()
    const cachedAge = now - grant.cachedAt.getTime()
    const oneHourInMs = 60 * 60 * 1000

    if (cachedAge > oneHourInMs) {
      return false
    }

    if (grant.remainingTokens !== undefined && grant.remainingTokens <= 0) {
      return false
    }

    return true
  }

  async getOrRenewGrant(
    forceRefresh = false,
    mockFetchMessage?: () => Promise<{ success: boolean; message: string; address: string }>,
    mockCheckStatus?: () => Promise<{
      success: boolean
      hasGrant: boolean
      grant?: { remainingTokens: number; totalTokens: number; expiresAt: string }
    }>
  ) {
    if (this.cachedGrant && !forceRefresh && this.isGrantValid(this.cachedGrant)) {
      return this.cachedGrant
    }

    if (!mockFetchMessage) {
      throw new Error('Mock fetch function required for testing')
    }

    const grantMessageResponse = await mockFetchMessage()
    const signature = await this.signMessage(grantMessageResponse.message)

    let remainingTokens: number | undefined
    if (mockCheckStatus) {
      try {
        const grantStatus = await mockCheckStatus()
        remainingTokens = grantStatus.grant?.remainingTokens
      } catch {
        // Non-critical
      }
    }

    this.cachedGrant = {
      message: grantMessageResponse.message,
      signature,
      walletAddress: this.getWalletAddress(),
      cachedAt: new Date(),
      remainingTokens,
    }

    return this.cachedGrant
  }

  clearCache(): void {
    this.cachedGrant = null
  }

  async getAuthenticationFields(
    forceRefresh = false,
    mockFetchMessage?: () => Promise<{ success: boolean; message: string; address: string }>,
    mockCheckStatus?: () => Promise<{
      success: boolean
      hasGrant: boolean
      grant?: { remainingTokens: number; totalTokens: number; expiresAt: string }
    }>
  ) {
    const grant = await this.getOrRenewGrant(forceRefresh, mockFetchMessage, mockCheckStatus)
    return {
      grantMessage: grant.message,
      grantSignature: grant.signature,
      walletAddress: grant.walletAddress,
    }
  }

  setExpiredGrant(message: string, signature: string, walletAddress: string) {
    this.cachedGrant = {
      message,
      signature,
      walletAddress,
      cachedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    }
  }

  setZeroTokenGrant(message: string, signature: string, walletAddress: string) {
    this.cachedGrant = {
      message,
      signature,
      walletAddress,
      cachedAt: new Date(),
      remainingTokens: 0,
    }
  }
}

describe('GrantAuthenticator', () => {
  let testWallet: Wallet
  let authenticator: TestGrantAuthenticator

  beforeEach(() => {
    testWallet = Wallet.createRandom()
    authenticator = new TestGrantAuthenticator(testWallet.privateKey)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initializeWallet', () => {
    it('should initialize wallet from private key', () => {
      const address = authenticator.getWalletAddress()
      expect(address).toBe(testWallet.address)
    })

    it('should throw error for missing private key', () => {
      const badAuth = new TestGrantAuthenticator('')
      expect(() => badAuth.getWalletAddress()).toThrow('EIGENAI_GRANT_PRIVATE_KEY is required')
    })

    it('should throw error for invalid private key', () => {
      const badAuth = new TestGrantAuthenticator('not-a-valid-key')
      expect(() => badAuth.getWalletAddress()).toThrow('Failed to initialize grant wallet')
    })
  })

  describe('getWalletAddress', () => {
    it('should return correct wallet address', () => {
      const address = authenticator.getWalletAddress()
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(address.toLowerCase()).toBe(testWallet.address.toLowerCase())
    })
  })

  describe('getOrRenewGrant', () => {
    const mockFetchMessage = async () => ({
      success: true,
      message: 'I authorize inference usage for wallet 0x123',
      address: testWallet.address,
    })

    const mockCheckStatus = async () => ({
      success: true,
      hasGrant: true,
      grant: {
        remainingTokens: 10000,
        totalTokens: 50000,
        expiresAt: '2025-12-31T23:59:59Z',
      },
    })

    it('should fetch and sign new grant', async () => {
      const grant = await authenticator.getOrRenewGrant(false, mockFetchMessage, mockCheckStatus)

      expect(grant.message).toBe('I authorize inference usage for wallet 0x123')
      expect(grant.signature).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(grant.walletAddress).toBe(testWallet.address)
      expect(grant.remainingTokens).toBe(10000)
    })

    it('should return cached grant if valid', async () => {
      const grant1 = await authenticator.getOrRenewGrant(false, mockFetchMessage, mockCheckStatus)
      const mockFetchCalledAgain = vi.fn(mockFetchMessage)
      const grant2 = await authenticator.getOrRenewGrant(
        false,
        mockFetchCalledAgain,
        mockCheckStatus
      )

      expect(grant1.signature).toBe(grant2.signature)
      expect(mockFetchCalledAgain).not.toHaveBeenCalled()
    })

    it('should force refresh when requested', async () => {
      const grant1 = await authenticator.getOrRenewGrant(false, mockFetchMessage, mockCheckStatus)

      const mockFetchNew = vi.fn(async () => ({
        success: true,
        message: 'New message for wallet',
        address: testWallet.address,
      }))

      const grant2 = await authenticator.getOrRenewGrant(true, mockFetchNew, mockCheckStatus)

      expect(mockFetchNew).toHaveBeenCalled()
      expect(grant2.message).toBe('New message for wallet')
    })

    it('should refresh expired grant', async () => {
      authenticator.setExpiredGrant('old message', '0xoldsig', testWallet.address)

      const mockFetchNew = vi.fn(mockFetchMessage)
      const grant = await authenticator.getOrRenewGrant(false, mockFetchNew, mockCheckStatus)

      expect(mockFetchNew).toHaveBeenCalled()
      expect(grant.message).toBe('I authorize inference usage for wallet 0x123')
    })

    it('should refresh grant with zero tokens', async () => {
      authenticator.setZeroTokenGrant('depleted', '0xsig', testWallet.address)

      const mockFetchNew = vi.fn(mockFetchMessage)
      const grant = await authenticator.getOrRenewGrant(false, mockFetchNew, mockCheckStatus)

      expect(mockFetchNew).toHaveBeenCalled()
    })

    it('should work without grant status check', async () => {
      const grant = await authenticator.getOrRenewGrant(false, mockFetchMessage)

      expect(grant.message).toBe('I authorize inference usage for wallet 0x123')
      expect(grant.remainingTokens).toBeUndefined()
    })
  })

  describe('clearCache', () => {
    it('should clear cached grant', async () => {
      const mockFetchMessage = async () => ({
        success: true,
        message: 'Test message',
        address: testWallet.address,
      })

      await authenticator.getOrRenewGrant(false, mockFetchMessage)
      authenticator.clearCache()

      const mockFetchNew = vi.fn(mockFetchMessage)
      await authenticator.getOrRenewGrant(false, mockFetchNew)

      expect(mockFetchNew).toHaveBeenCalled()
    })
  })

  describe('getAuthenticationFields', () => {
    it('should return authentication fields for API request', async () => {
      const mockFetchMessage = async () => ({
        success: true,
        message: 'Auth message',
        address: testWallet.address,
      })

      const fields = await authenticator.getAuthenticationFields(false, mockFetchMessage)

      expect(fields.grantMessage).toBe('Auth message')
      expect(fields.grantSignature).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(fields.walletAddress).toBe(testWallet.address)
    })
  })

  describe('Grant Validation', () => {
    it('should consider grant expired after 1 hour', async () => {
      authenticator.setExpiredGrant('old', '0x', testWallet.address)

      const mockFetch = vi.fn(async () => ({
        success: true,
        message: 'New',
        address: testWallet.address,
      }))

      await authenticator.getOrRenewGrant(false, mockFetch)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should consider grant invalid with zero tokens', async () => {
      authenticator.setZeroTokenGrant('depleted', '0x', testWallet.address)

      const mockFetch = vi.fn(async () => ({
        success: true,
        message: 'New',
        address: testWallet.address,
      }))

      await authenticator.getOrRenewGrant(false, mockFetch)
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('Signature Verification', () => {
    it('should produce verifiable signatures', async () => {
      const mockFetchMessage = async () => ({
        success: true,
        message: 'Verify this message',
        address: testWallet.address,
      })

      const grant = await authenticator.getOrRenewGrant(false, mockFetchMessage)

      const { verifyMessage } = await import('ethers')
      const recoveredAddress = verifyMessage('Verify this message', grant.signature)

      expect(recoveredAddress.toLowerCase()).toBe(testWallet.address.toLowerCase())
    })
  })
})
