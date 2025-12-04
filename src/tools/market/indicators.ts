/**
 * Technical Indicator Calculations
 * Ported from ai-trading-agent's hyperliquid_indicators.py
 *
 * All calculations are done locally from OHLCV candle data
 */
import { type CandleData } from './coingecko-client.js'

/**
 * Calculate Exponential Moving Average
 *
 * @param prices - Array of price values
 * @param period - EMA period
 * @returns EMA value or null if insufficient data
 */
export function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) {
    return null
  }

  // Use exponential weights
  const weights: number[] = []
  for (let i = 0; i < period; i++) {
    weights.push(Math.exp((-1 + i / (period - 1)) * 1))
  }

  // Normalize weights
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const normalizedWeights = weights.map((w) => w / weightSum)

  // Calculate weighted average for the most recent 'period' prices
  const recentPrices = prices.slice(-period)
  let ema = 0
  for (let i = 0; i < period; i++) {
    ema += recentPrices[i] * normalizedWeights[i]
  }

  return Math.round(ema * 10000) / 10000
}

/**
 * Calculate Simple Moving Average
 *
 * @param prices - Array of price values
 * @param period - SMA period
 * @returns SMA value or null if insufficient data
 */
export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) {
    return null
  }

  const recentPrices = prices.slice(-period)
  const sum = recentPrices.reduce((a, b) => a + b, 0)

  return Math.round((sum / period) * 10000) / 10000
}

/**
 * Calculate Relative Strength Index
 *
 * @param prices - Array of price values
 * @param period - RSI period (typically 14)
 * @returns RSI value (0-100) or null if insufficient data
 */
export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) {
    return null
  }

  // Calculate price changes
  const recentPrices = prices.slice(-(period + 1))
  const deltas: number[] = []
  for (let i = 1; i < recentPrices.length; i++) {
    deltas.push(recentPrices[i] - recentPrices[i - 1])
  }

  // Separate gains and losses
  const gains = deltas.map((d) => (d > 0 ? d : 0))
  const losses = deltas.map((d) => (d < 0 ? Math.abs(d) : 0))

  // Calculate average gains and losses
  const avgGain = gains.reduce((a, b) => a + b, 0) / period
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period

  // Handle edge cases
  if (avgLoss === 0) {
    return avgGain === 0 ? 50.0 : 100.0
  }
  if (avgGain === 0) {
    return 0.0
  }

  // Calculate RSI
  const rs = avgGain / avgLoss
  const rsi = 100 - 100 / (1 + rs)

  // Handle NaN or Infinity
  if (!isFinite(rsi)) {
    return 50.0
  }

  return Math.round(rsi * 100) / 100
}

/**
 * MACD result structure
 */
export interface MACDResult {
  macd: number | null
  signal: number | null
  histogram: number | null
}

/**
 * Calculate EMA series for MACD calculation
 */
function calculateEMASeries(data: number[], period: number): number[] {
  if (data.length < period) {
    return []
  }

  const ema: number[] = []
  const multiplier = 2 / (period + 1)

  // Start with SMA for first EMA value
  const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period
  ema.push(sma)

  // Calculate EMA for rest of the data
  for (let i = period; i < data.length; i++) {
    const emaVal = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]
    ema.push(emaVal)
  }

  return ema
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * @param prices - Array of price values
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal line period (default 9)
 * @returns MACD, signal, and histogram values
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  if (prices.length < slowPeriod) {
    return { macd: null, signal: null, histogram: null }
  }

  // Calculate EMAs
  const emaFast = calculateEMASeries(prices, fastPeriod)
  const emaSlow = calculateEMASeries(prices, slowPeriod)

  if (emaFast.length === 0 || emaSlow.length === 0) {
    return { macd: null, signal: null, histogram: null }
  }

  // Calculate MACD line (difference between fast and slow EMA)
  // Align the arrays - emaSlow starts later
  const offset = slowPeriod - fastPeriod
  const macdLine: number[] = []
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i])
  }

  if (macdLine.length < signalPeriod) {
    return {
      macd: Math.round(macdLine[macdLine.length - 1] * 10000) / 10000,
      signal: null,
      histogram: null,
    }
  }

  // Calculate signal line (EMA of MACD)
  const signalLine = calculateEMASeries(macdLine, signalPeriod)

  if (signalLine.length === 0) {
    return {
      macd: Math.round(macdLine[macdLine.length - 1] * 10000) / 10000,
      signal: null,
      histogram: null,
    }
  }

  // Calculate histogram
  const macdValue = macdLine[macdLine.length - 1]
  const signalValue = signalLine[signalLine.length - 1]
  const histogram = macdValue - signalValue

  return {
    macd: Math.round(macdValue * 10000) / 10000,
    signal: Math.round(signalValue * 10000) / 10000,
    histogram: Math.round(histogram * 10000) / 10000,
  }
}

/**
 * Calculate Average True Range
 *
 * @param candles - Array of candle data
 * @param period - ATR period (default 14)
 * @returns ATR value or null if insufficient data
 */
export function calculateATR(candles: CandleData[], period: number = 14): number | null {
  if (candles.length < period + 1) {
    return null
  }

  const trueRanges: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close

    // True Range is the maximum of:
    // 1. Current High - Current Low
    // 2. |Current High - Previous Close|
    // 3. |Current Low - Previous Close|
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))

    trueRanges.push(tr)
  }

  if (trueRanges.length < period) {
    return null
  }

  // Calculate ATR as SMA of true ranges
  const recentTR = trueRanges.slice(-period)
  const atr = recentTR.reduce((a, b) => a + b, 0) / period

  return Math.round(atr * 100) / 100
}

/**
 * Calculate Volume-Weighted Average Price
 *
 * @param candles - Array of candle data
 * @param lookback - Number of candles to use (optional, uses all if not specified)
 * @returns VWAP value or null if insufficient data
 */
export function calculateVWAP(candles: CandleData[], lookback?: number): number | null {
  if (!candles || candles.length < 2) {
    return null
  }

  const candlesToUse = lookback ? candles.slice(-lookback) : candles

  let totalPV = 0 // price × volume
  let totalVolume = 0

  for (const candle of candlesToUse) {
    if (candle.volume <= 0) {
      continue
    }

    // Typical price = (High + Low + Close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3

    totalPV += typicalPrice * candle.volume
    totalVolume += candle.volume
  }

  if (totalVolume === 0) {
    return null
  }

  const vwap = totalPV / totalVolume

  return Math.round(vwap * 100) / 100
}

/**
 * Standard technical indicators bundle
 */
export interface TechnicalIndicators {
  ema20: number | null
  ema50: number | null
  sma20: number | null
  rsi7: number | null
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  atr14: number | null
  vwap: number | null
}

/**
 * Calculate all standard indicators from candles
 *
 * @param candles - Array of candle data
 * @returns Object with all calculated indicators
 */
export function calculateIndicators(candles: CandleData[]): TechnicalIndicators {
  if (candles.length === 0) {
    return {
      ema20: null,
      ema50: null,
      sma20: null,
      rsi7: null,
      rsi14: null,
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      atr14: null,
      vwap: null,
    }
  }

  // Extract close prices
  const closes = candles.map((c) => c.close)

  // Calculate all indicators
  const macdResult = calculateMACD(closes)

  return {
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    sma20: calculateSMA(closes, 20),
    rsi7: calculateRSI(closes, 7),
    rsi14: calculateRSI(closes, 14),
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    atr14: calculateATR(candles, 14),
    vwap: calculateVWAP(candles, 100),
  }
}

/**
 * Get a series of indicator values (last N values)
 *
 * @param candles - Array of candle data
 * @param indicator - Indicator name ('rsi', 'ema', 'macd')
 * @param period - Period for the indicator
 * @param seriesLength - Number of values to return (default 10)
 * @returns Array of indicator values
 */
export function getIndicatorSeries(
  candles: CandleData[],
  indicator: 'rsi' | 'ema' | 'macd',
  period: number,
  seriesLength: number = 10
): number[] {
  const closes = candles.map((c) => c.close)
  const series: number[] = []

  if (indicator === 'rsi') {
    const requiredLength = period + 1
    for (let i = requiredLength; i <= closes.length; i++) {
      const value = calculateRSI(closes.slice(0, i), period)
      if (value !== null && isFinite(value)) {
        series.push(value)
      }
    }
  } else if (indicator === 'ema') {
    for (let i = period; i <= closes.length; i++) {
      const value = calculateEMA(closes.slice(0, i), period)
      if (value !== null) {
        series.push(value)
      }
    }
  } else if (indicator === 'macd') {
    const slowPeriod = 26
    for (let i = slowPeriod; i <= closes.length; i++) {
      const result = calculateMACD(closes.slice(0, i))
      if (result.macd !== null) {
        series.push(result.macd)
      }
    }
  }

  // Return last N values
  return series.slice(-seriesLength)
}
