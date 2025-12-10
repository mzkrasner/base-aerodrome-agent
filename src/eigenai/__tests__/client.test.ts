/**
 * EigenAI Client Tests
 *
 * Tests for capturing and processing EigenAI API responses.
 */
import { Wallet } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../types.js'
import {
  captureRequestResponse,
  clearCapturedData,
  getLastCapturedRequest,
  getLastCapturedResponse,
  getEigenAIConfigSummary,
  processAndVerifyLastResponse,
} from '../client.js'

describe('EigenAI Client', () => {
  let testWallet: Wallet
  let mockRequest: ChatCompletionRequest
  let mockResponse: ChatCompletionResponse

  beforeEach(() => {
    testWallet = Wallet.createRandom()
    clearCapturedData()

    mockRequest = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
      model: 'gpt-oss-120b-f16',
      grantMessage: 'test',
      grantSignature: '0x',
      walletAddress: '0x123',
    }

    mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-oss-120b-f16',
      system_fingerprint: 'fp_abc',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help?' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      signature: '0x' + 'a'.repeat(130),
    }
  })

  afterEach(() => {
    clearCapturedData()
  })

  describe('captureRequestResponse', () => {
    it('should capture request and response', () => {
      captureRequestResponse(mockRequest, mockResponse)

      const capturedRequest = getLastCapturedRequest()
      const capturedResponse = getLastCapturedResponse()

      expect(capturedRequest).toEqual(mockRequest)
      expect(capturedResponse).toEqual(mockResponse)
    })

    it('should overwrite previous capture', () => {
      const firstRequest = { ...mockRequest, model: 'model-1' }
      const secondRequest = { ...mockRequest, model: 'model-2' }

      captureRequestResponse(firstRequest, mockResponse)
      captureRequestResponse(secondRequest, mockResponse)

      const capturedRequest = getLastCapturedRequest()
      expect(capturedRequest?.model).toBe('model-2')
    })
  })

  describe('clearCapturedData', () => {
    it('should clear captured request and response', () => {
      captureRequestResponse(mockRequest, mockResponse)
      clearCapturedData()

      expect(getLastCapturedRequest()).toBeNull()
      expect(getLastCapturedResponse()).toBeNull()
    })
  })

  describe('processAndVerifyLastResponse', () => {
    it('should return null when no data captured', async () => {
      const result = await processAndVerifyLastResponse(1)
      expect(result).toBeNull()
    })

    it('should return null when response has no signature', async () => {
      const responseWithoutSignature = { ...mockResponse, signature: '' }
      captureRequestResponse(mockRequest, responseWithoutSignature)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = await processAndVerifyLastResponse(1)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith('EigenAI response has no signature field')
      consoleSpy.mockRestore()
    })

    it('should process and verify valid signature', async () => {
      const message = `1gpt-oss-120b-f16You are a helpful assistant.Hello!Hello! How can I help?`
      const signature = await testWallet.signMessage(message)

      const signedResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }
      captureRequestResponse(mockRequest, signedResponse)

      vi.spyOn(console, 'log').mockImplementation(() => {})

      const result = await processAndVerifyLastResponse(42)

      expect(result).not.toBeNull()
      expect(result!.iterationNumber).toBe(42)
      expect(result!.modelId).toBe('gpt-oss-120b-f16')
      expect(result!.signature).toBe(signature)
      expect(result!.requestHash).toMatch(/^0x[a-f0-9]{64}$/)
      expect(result!.responseHash).toMatch(/^0x[a-f0-9]{64}$/)
      expect(result!.submittedToRecall).toBe(false)
    })

    it('should mark invalid signature as invalid', async () => {
      const differentWallet = Wallet.createRandom()
      const wrongMessage = 'wrong message'
      const signature = await differentWallet.signMessage(wrongMessage)

      const signedResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }
      captureRequestResponse(mockRequest, signedResponse)

      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await processAndVerifyLastResponse(1)

      expect(result).not.toBeNull()
      expect(result!.localVerificationStatus).toBe('invalid')
    })

    it('should clear captured data after processing', async () => {
      captureRequestResponse(mockRequest, mockResponse)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processAndVerifyLastResponse(1)

      expect(getLastCapturedRequest()).toBeNull()
      expect(getLastCapturedResponse()).toBeNull()
    })
  })

  describe('getEigenAIConfigSummary', () => {
    it('should return config summary without sensitive data', () => {
      const summary = getEigenAIConfigSummary()

      expect(summary).toHaveProperty('enabled')
      expect(summary).toHaveProperty('apiUrl')
      expect(summary).toHaveProperty('modelId')
      expect(summary).toHaveProperty('chainId')
      expect(summary).toHaveProperty('expectedSigner')
      expect(summary).toHaveProperty('recallEnabled')
      expect(summary).not.toHaveProperty('grantWalletPrivateKey')
    })

    it('should return expected default values', () => {
      const summary = getEigenAIConfigSummary()

      expect(summary.chainId).toBe('1')
      expect(summary.expectedSigner).toBe('0x7053bfb0433a16a2405de785d547b1b32cee0cf3')
    })
  })
})
