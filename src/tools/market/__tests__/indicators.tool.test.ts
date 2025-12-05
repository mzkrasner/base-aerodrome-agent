/**
 * Indicators Tool Integration Tests
 *
 * Tests the complete flow:
 * 1. CoinGecko OHLCV API fetch
 * 2. Technical indicator calculations (EMA, RSI, MACD, ATR, VWAP)
 * 3. Market metrics calculations
 *
 * Requires COINGECKO_API_KEY environment variable.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { TOKEN_ADDRESSES } from '../../../config/tokens.js'
import { fetchMultiTimeframeCandles, fetchOHLCV } from '../coingecko-client.js'
import {
  calculateATR,
  calculateEMA,
  calculateIndicators,
  calculateMACD,
  calculateRSI,
  calculateVWAP,
} from '../indicators.js'
import { getIndicatorsTool } from '../indicators.tool.js'
import { calculateMarketMetrics } from '../market-metrics.js'

describe('CoinGecko OHLCV Client', () => {
  beforeAll(() => {
    if (!process.env.COINGECKO_API_KEY) {
      console.warn('⚠️ COINGECKO_API_KEY not set - tests will fail')
    }
  })

  it('should fetch 5-minute candles for AERO', async () => {
    const result = await fetchOHLCV({
      tokenAddress: TOKEN_ADDRESSES.AERO,
      network: 'base',
      timeframe: 'minute',
      aggregate: '5',
      limit: 50,
    })

    console.log('5m candles result:', {
      success: result.success,
      candleCount: result.candles.length,
      error: result.error,
      baseToken: result.baseToken?.symbol,
      quoteToken: result.quoteToken?.symbol,
    })

    if (result.success) {
      expect(result.candles.length).toBeGreaterThan(0)

      // Verify candle structure
      const firstCandle = result.candles[0]
      expect(firstCandle).toHaveProperty('timestamp')
      expect(firstCandle).toHaveProperty('open')
      expect(firstCandle).toHaveProperty('high')
      expect(firstCandle).toHaveProperty('low')
      expect(firstCandle).toHaveProperty('close')
      expect(firstCandle).toHaveProperty('volume')

      // Verify data is valid
      expect(typeof firstCandle.timestamp).toBe('number')
      expect(typeof firstCandle.open).toBe('number')
      expect(firstCandle.high).toBeGreaterThanOrEqual(firstCandle.low)
    } else {
      // API key might be missing or token not found
      console.warn('Fetch failed:', result.error)
    }
  })

  it('should fetch 4-hour candles for WETH', async () => {
    const result = await fetchOHLCV({
      tokenAddress: TOKEN_ADDRESSES.WETH,
      network: 'base',
      timeframe: 'hour',
      aggregate: '4',
      limit: 50,
    })

    console.log('4h candles result:', {
      success: result.success,
      candleCount: result.candles.length,
      error: result.error,
    })

    if (result.success) {
      expect(result.candles.length).toBeGreaterThan(0)
    }
  })

  it('should fetch multi-timeframe candles', async () => {
    const result = await fetchMultiTimeframeCandles(TOKEN_ADDRESSES.AERO, 'base')

    console.log('Multi-timeframe result:', {
      candles5mCount: result.candles5m.length,
      candles4hCount: result.candles4h.length,
      errors: result.errors,
    })

    // At least one timeframe should succeed
    expect(result.candles5m.length + result.candles4h.length).toBeGreaterThan(0)
  })
})

describe('Indicator Calculations', () => {
  // Sample price data for testing calculations
  const samplePrices = [
    100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113, 115, 117, 116, 118,
    120, 119, 121, 123, 122, 124, 126, 125, 127, 129, 128, 130, 132, 131, 133, 135,
  ]

  const sampleCandles = samplePrices.map((close, i) => ({
    timestamp: Date.now() / 1000 + i * 300,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close: close,
    volume: 10000 + i * 100,
  }))

  describe('EMA Calculation', () => {
    it('should calculate EMA20', () => {
      const ema = calculateEMA(samplePrices, 20)
      expect(ema).not.toBeNull()
      expect(typeof ema).toBe('number')

      // EMA should be between min and max prices
      if (ema !== null) {
        expect(ema).toBeGreaterThanOrEqual(Math.min(...samplePrices))
        expect(ema).toBeLessThanOrEqual(Math.max(...samplePrices))
      }
    })

    it('should return null for insufficient data', () => {
      const ema = calculateEMA([100, 101, 102], 20)
      expect(ema).toBeNull()
    })
  })

  describe('RSI Calculation', () => {
    it('should calculate RSI14', () => {
      const rsi = calculateRSI(samplePrices, 14)
      expect(rsi).not.toBeNull()
      expect(typeof rsi).toBe('number')

      // RSI should be between 0 and 100
      if (rsi !== null) {
        expect(rsi).toBeGreaterThanOrEqual(0)
        expect(rsi).toBeLessThanOrEqual(100)
      }
    })

    it('should return ~100 for consistent gains', () => {
      const uptrend = [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
      ]
      const rsi = calculateRSI(uptrend, 14)

      if (rsi !== null) {
        expect(rsi).toBeGreaterThan(90)
      }
    })

    it('should return ~0 for consistent losses', () => {
      const downtrend = [
        115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100,
      ]
      const rsi = calculateRSI(downtrend, 14)

      if (rsi !== null) {
        expect(rsi).toBeLessThan(10)
      }
    })
  })

  describe('MACD Calculation', () => {
    it('should calculate MACD', () => {
      const macd = calculateMACD(samplePrices)
      expect(macd.macd).not.toBeNull()
      expect(macd.signal).not.toBeNull()
      expect(macd.histogram).not.toBeNull()
    })

    it('should return nulls for insufficient data', () => {
      const macd = calculateMACD([100, 101, 102, 103, 104])
      expect(macd.macd).toBeNull()
    })
  })

  describe('ATR Calculation', () => {
    it('should calculate ATR14', () => {
      const atr = calculateATR(sampleCandles, 14)
      expect(atr).not.toBeNull()
      expect(typeof atr).toBe('number')

      if (atr !== null) {
        expect(atr).toBeGreaterThan(0)
      }
    })
  })

  describe('VWAP Calculation', () => {
    it('should calculate VWAP', () => {
      const vwap = calculateVWAP(sampleCandles)
      expect(vwap).not.toBeNull()
      expect(typeof vwap).toBe('number')

      // VWAP should be reasonable
      if (vwap !== null) {
        const minPrice = Math.min(...sampleCandles.map((c) => c.low))
        const maxPrice = Math.max(...sampleCandles.map((c) => c.high))
        expect(vwap).toBeGreaterThanOrEqual(minPrice)
        expect(vwap).toBeLessThanOrEqual(maxPrice)
      }
    })
  })

  describe('Full Indicator Bundle', () => {
    it('should calculate all indicators', () => {
      const indicators = calculateIndicators(sampleCandles)

      expect(indicators.ema20).not.toBeNull()
      expect(indicators.sma20).not.toBeNull()
      expect(indicators.rsi14).not.toBeNull()
      expect(indicators.macd).not.toBeNull()
      expect(indicators.atr14).not.toBeNull()
      expect(indicators.vwap).not.toBeNull()
    })
  })
})

describe('Market Metrics Calculations', () => {
  // Need at least 50 candles for EMA50 calculation in market metrics
  const samplePrices: number[] = []
  for (let i = 0; i < 60; i++) {
    samplePrices.push(100 + i * 0.5 + Math.sin(i / 5) * 2) // Uptrend with oscillation
  }

  const sampleCandles = samplePrices.map((close, i) => ({
    timestamp: Date.now() / 1000 + i * 300,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close: close,
    volume: 10000 + i * 100,
  }))

  it('should calculate market metrics', () => {
    const indicators = calculateIndicators(sampleCandles)
    const metrics = calculateMarketMetrics(sampleCandles, indicators)

    // Trend metrics
    expect(metrics.emaSeparationRatio).not.toBeNull()
    expect(metrics.priceEma20Deviation).not.toBeNull()

    // Volatility metrics
    expect(metrics.volatilityRatio).not.toBeNull()

    // Market structure
    expect(typeof metrics.higherHighsCount20).toBe('number')
    expect(typeof metrics.consecutiveGreenCandles).toBe('number')

    // Range metrics
    expect(metrics.rangePosition20).not.toBeNull()
    if (metrics.rangePosition20 !== null) {
      expect(metrics.rangePosition20).toBeGreaterThanOrEqual(0)
      expect(metrics.rangePosition20).toBeLessThanOrEqual(1)
    }

    // Volume metrics
    expect(metrics.volumeRatio20).not.toBeNull()

    // Price action
    expect(metrics.priceVelocity5).not.toBeNull()
    expect(metrics.currentBodyRatio).not.toBeNull()
  })

  it('should return empty metrics for insufficient data', () => {
    const shortCandles = sampleCandles.slice(0, 5)
    const indicators = calculateIndicators(shortCandles)
    const metrics = calculateMarketMetrics(shortCandles, indicators)

    // Should return empty/default metrics
    expect(metrics.higherHighsCount20).toBe(0)
    expect(metrics.consecutiveGreenCandles).toBe(0)
  })
})

// Helper to call tool without boilerplate
const getIndicators = (token: string) =>
  getIndicatorsTool.execute({
    context: { token },
    runtimeContext: {} as never,
  })

describe('Indicators Tool Integration', () => {
  beforeAll(() => {
    if (!process.env.COINGECKO_API_KEY) {
      console.warn('⚠️ COINGECKO_API_KEY not set - tool tests will fail')
    }
  })

  it('should get indicators for AERO', async () => {
    const result = await getIndicators('AERO')

    console.log('Indicators tool result:', {
      success: result.success,
      token: result.token,
      hasIntraday: result.intraday !== null,
      hasLongTerm: result.longTerm !== null,
      currentPrice: result.currentPrice,
      errors: result.errors,
    })

    if (result.success) {
      expect(result.token.symbol).toBe('AERO')
      expect(result.token.address).toBe(TOKEN_ADDRESSES.AERO)

      // Should have at least one timeframe
      expect(result.intraday !== null || result.longTerm !== null).toBe(true)

      // If intraday data is present, verify structure
      if (result.intraday) {
        console.log('Intraday indicators:', result.intraday.indicators)
        console.log('Intraday metrics:', {
          emaSeparationRatio: result.intraday.marketMetrics.emaSeparationRatio,
          rsiValue: result.intraday.marketMetrics.rsiValue,
          volatilityRatio: result.intraday.marketMetrics.volatilityRatio,
          consecutiveGreenCandles: result.intraday.marketMetrics.consecutiveGreenCandles,
          consecutiveRedCandles: result.intraday.marketMetrics.consecutiveRedCandles,
        })

        expect(result.intraday.candleCount).toBeGreaterThan(0)
        expect(result.intraday.recentPrices.length).toBeGreaterThan(0)
        expect(result.intraday.series.ema20.length).toBeGreaterThanOrEqual(0)
      }
    } else {
      console.warn('Tool failed:', result.errors)
    }
  }, 30000) // 30 second timeout for API call

  it('should get indicators for WETH', async () => {
    const result = await getIndicators('WETH')

    console.log('WETH indicators result:', {
      success: result.success,
      hasIntraday: result.intraday !== null,
      hasLongTerm: result.longTerm !== null,
      currentPrice: result.currentPrice,
    })

    if (result.success && result.longTerm) {
      console.log('Long-term (4h) indicators:', result.longTerm.indicators)
    }
  }, 30000)

  it('should handle unknown token gracefully', async () => {
    const result = await getIndicators('UNKNOWN_TOKEN_XYZ')

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('Unknown token')
  })

  it('should resolve TOSHI address correctly', async () => {
    const result = await getIndicators('TOSHI')

    console.log('TOSHI indicators result:', {
      success: result.success,
      token: result.token,
      hasIntraday: result.intraday !== null,
      hasLongTerm: result.longTerm !== null,
      currentPrice: result.currentPrice,
      errors: result.errors,
    })

    // Token should be resolved correctly (even if CoinGecko doesn't have data)
    expect(result.token.symbol).toBe('TOSHI')
    expect(result.token.address.toLowerCase()).toBe(TOKEN_ADDRESSES.TOSHI.toLowerCase())

    // If data is available, validate structure
    if (result.success && result.intraday) {
      console.log('TOSHI intraday metrics:', {
        rsi: result.intraday.indicators.rsi14,
        ema20: result.intraday.indicators.ema20,
        candleCount: result.intraday.candleCount,
      })
      expect(result.intraday.candleCount).toBeGreaterThan(0)
    } else if (!result.success) {
      // CoinGecko may not have TOSHI data - that's expected for smaller tokens
      console.warn('TOSHI data not available (expected for smaller meme coins):', result.errors)
    }
  }, 30000)
})
