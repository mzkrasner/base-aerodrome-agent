/**
 * Market Metrics Calculations
 * Derived metrics from OHLCV data and technical indicators
 *
 * These metrics provide objective measurements without prescriptive interpretation.
 * The agent decides what the metrics mean.
 *
 * Ported from ai-trading-agent's hyperliquid_indicators.py calculate_market_metrics()
 */
import { type CandleData } from './coingecko-client.js'
import { type TechnicalIndicators, calculateMACD } from './indicators.js'

/**
 * Market metrics structure
 * All metrics are objective measurements, no interpretation
 */
export interface MarketMetrics {
  // Trend metrics
  emaSeparationRatio: number | null
  priceEma20Deviation: number | null
  priceEma50Deviation: number | null

  // Volatility metrics
  currentRangePercent: number | null
  avgRangePercent20: number | null
  volatilityRatio: number | null
  atrPriceRatio: number | null

  // Momentum metrics
  rsiValue: number | null
  rsiDistanceFrom50: number | null
  macdValue: number | null
  macdSignalValue: number | null
  macdCrossDistance: number | null
  macdHistogram: number | null
  macdHistogramSlope3: number | null

  // Market structure metrics
  higherHighsCount20: number
  lowerLowsCount20: number
  higherLowsCount20: number
  lowerHighsCount20: number
  consecutiveGreenCandles: number
  consecutiveRedCandles: number

  // Range metrics
  rangePosition20: number | null
  distanceFromHigh20: number | null
  distanceFromLow20: number | null

  // Volume metrics
  volumeRatio20: number | null
  volumeTrend5: number | null

  // Price action metrics
  priceVelocity5: number | null
  priceVelocity10: number | null

  // Candle analysis
  currentBodyRatio: number | null
  upperWickRatio: number | null
  lowerWickRatio: number | null
}

/**
 * Count higher highs in a sequence
 */
function countHigherHighs(highs: number[]): number {
  let count = 0
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] > highs[i - 1]) {
      count++
    }
  }
  return count
}

/**
 * Count lower lows in a sequence
 */
function countLowerLows(lows: number[]): number {
  let count = 0
  for (let i = 1; i < lows.length; i++) {
    if (lows[i] < lows[i - 1]) {
      count++
    }
  }
  return count
}

/**
 * Count higher lows in a sequence
 */
function countHigherLows(lows: number[]): number {
  let count = 0
  for (let i = 1; i < lows.length; i++) {
    if (lows[i] > lows[i - 1]) {
      count++
    }
  }
  return count
}

/**
 * Count lower highs in a sequence
 */
function countLowerHighs(highs: number[]): number {
  let count = 0
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] < highs[i - 1]) {
      count++
    }
  }
  return count
}

/**
 * Count consecutive green candles from most recent
 */
function countConsecutiveGreen(candles: CandleData[]): number {
  let count = 0
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close > candles[i].open) {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Count consecutive red candles from most recent
 */
function countConsecutiveRed(candles: CandleData[]): number {
  let count = 0
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].close < candles[i].open) {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Round a number to specified decimal places
 */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

/**
 * Calculate market metrics from candles and indicators
 *
 * @param candles - Array of OHLCV candle data (minimum 20 for meaningful results)
 * @param indicators - Pre-calculated technical indicators
 * @returns Market metrics object
 */
export function calculateMarketMetrics(
  candles: CandleData[],
  indicators: TechnicalIndicators
): MarketMetrics {
  // Default empty metrics
  const emptyMetrics: MarketMetrics = {
    emaSeparationRatio: null,
    priceEma20Deviation: null,
    priceEma50Deviation: null,
    currentRangePercent: null,
    avgRangePercent20: null,
    volatilityRatio: null,
    atrPriceRatio: null,
    rsiValue: null,
    rsiDistanceFrom50: null,
    macdValue: null,
    macdSignalValue: null,
    macdCrossDistance: null,
    macdHistogram: null,
    macdHistogramSlope3: null,
    higherHighsCount20: 0,
    lowerLowsCount20: 0,
    higherLowsCount20: 0,
    lowerHighsCount20: 0,
    consecutiveGreenCandles: 0,
    consecutiveRedCandles: 0,
    rangePosition20: null,
    distanceFromHigh20: null,
    distanceFromLow20: null,
    volumeRatio20: null,
    volumeTrend5: null,
    priceVelocity5: null,
    priceVelocity10: null,
    currentBodyRatio: null,
    upperWickRatio: null,
    lowerWickRatio: null,
  }

  if (candles.length < 20) {
    return emptyMetrics
  }

  const metrics: MarketMetrics = { ...emptyMetrics }

  // Extract price data
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const volumes = candles.map((c) => c.volume)

  const currentPrice = closes[closes.length - 1]

  // Trend Metrics
  if (indicators.ema20 !== null && indicators.ema50 !== null) {
    // EMA relationship (positive = bullish structure)
    const emaSeparation = (indicators.ema20 - indicators.ema50) / indicators.ema50
    metrics.emaSeparationRatio = round(emaSeparation, 5)

    // Price position relative to EMAs
    const priceVsEma20 = (currentPrice - indicators.ema20) / indicators.ema20
    metrics.priceEma20Deviation = round(priceVsEma20, 5)

    const priceVsEma50 = (currentPrice - indicators.ema50) / indicators.ema50
    metrics.priceEma50Deviation = round(priceVsEma50, 5)
  }

  // Volatility Metrics
  // Calculate normalized ranges (high-low as % of close)
  const recentRanges: number[] = []
  for (let i = candles.length - 20; i < candles.length; i++) {
    const range = (highs[i] - lows[i]) / closes[i]
    recentRanges.push(range)
  }

  const currentRange = recentRanges[recentRanges.length - 1]
  const avgRange20 = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length

  metrics.currentRangePercent = round(currentRange, 5)
  metrics.avgRangePercent20 = round(avgRange20, 5)
  metrics.volatilityRatio = avgRange20 > 0 ? round(currentRange / avgRange20, 3) : null

  // ATR-based volatility
  if (indicators.atr14 !== null) {
    metrics.atrPriceRatio = round(indicators.atr14 / currentPrice, 5)
  }

  // Momentum Metrics
  if (indicators.rsi14 !== null) {
    metrics.rsiValue = indicators.rsi14
    metrics.rsiDistanceFrom50 = round(indicators.rsi14 - 50, 2)
  }

  if (indicators.macd !== null && indicators.macdSignal !== null) {
    metrics.macdValue = indicators.macd
    metrics.macdSignalValue = indicators.macdSignal
    metrics.macdCrossDistance = round(indicators.macd - indicators.macdSignal, 5)
  }

  if (indicators.macdHistogram !== null) {
    metrics.macdHistogram = indicators.macdHistogram

    // Calculate histogram slope (change over last 3 candles if available)
    if (candles.length >= 3) {
      const closesBack3 = closes.slice(-3)
      const macdBack3 = calculateMACD(closesBack3)
      if (macdBack3.histogram !== null) {
        const histChange = indicators.macdHistogram - macdBack3.histogram
        metrics.macdHistogramSlope3 = round(histChange, 5)
      }
    }
  }

  // Market Structure Metrics
  const recent20Highs = highs.slice(-20)
  const recent20Lows = lows.slice(-20)

  metrics.higherHighsCount20 = countHigherHighs(recent20Highs)
  metrics.lowerLowsCount20 = countLowerLows(recent20Lows)
  metrics.higherLowsCount20 = countHigherLows(recent20Lows)
  metrics.lowerHighsCount20 = countLowerHighs(recent20Highs)

  // Consecutive candle analysis
  metrics.consecutiveGreenCandles = countConsecutiveGreen(candles)
  metrics.consecutiveRedCandles = countConsecutiveRed(candles)

  // Range position
  const recentHigh = Math.max(...recent20Highs)
  const recentLow = Math.min(...recent20Lows)

  if (recentHigh > recentLow) {
    const rangePosition = (currentPrice - recentLow) / (recentHigh - recentLow)
    metrics.rangePosition20 = round(rangePosition, 3)
    metrics.distanceFromHigh20 = round((recentHigh - currentPrice) / currentPrice, 5)
    metrics.distanceFromLow20 = round((currentPrice - recentLow) / currentPrice, 5)
  }

  // Volume Metrics
  if (volumes.length > 20) {
    const currentVolume = volumes[volumes.length - 1]
    const recent20Volumes = volumes.slice(-20)
    const avgVolume20 = recent20Volumes.reduce((a, b) => a + b, 0) / 20

    metrics.volumeRatio20 = avgVolume20 > 0 ? round(currentVolume / avgVolume20, 3) : null

    // Volume trend (last 5 vs previous 5)
    const last5Volume = volumes.slice(-5).reduce((a, b) => a + b, 0)
    const prev5Volume = volumes.slice(-10, -5).reduce((a, b) => a + b, 0)
    metrics.volumeTrend5 = prev5Volume > 0 ? round(last5Volume / prev5Volume, 3) : null
  }

  // Price Action Metrics
  if (closes.length >= 10) {
    const priceChange5 =
      (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]
    const priceChange10 =
      (closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]
    metrics.priceVelocity5 = round(priceChange5, 5)
    metrics.priceVelocity10 = round(priceChange10, 5)
  }

  // Candle body vs wick analysis (current candle)
  const currentCandle = candles[candles.length - 1]
  const openPrice = currentCandle.open
  const high = currentCandle.high
  const low = currentCandle.low
  const close = currentCandle.close

  const bodySize = Math.abs(close - openPrice)
  const candleRange = high - low

  if (candleRange > 0) {
    metrics.currentBodyRatio = round(bodySize / candleRange, 3)

    // Upper and lower wick ratios
    const upperWick = high - Math.max(openPrice, close)
    const lowerWick = Math.min(openPrice, close) - low
    metrics.upperWickRatio = round(upperWick / candleRange, 3)
    metrics.lowerWickRatio = round(lowerWick / candleRange, 3)
  }

  return metrics
}
