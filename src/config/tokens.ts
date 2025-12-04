/**
 * Token Configuration for Aerodrome Trading on Base Chain
 * Contains addresses and metadata for tradeable tokens
 */

/** Base chain token addresses */
export const TOKEN_ADDRESSES = {
  /** Wrapped ETH on Base */
  WETH: '0x4200000000000000000000000000000000000006',
  /** USDC on Base (native, not bridged) */
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  /** Bridged USDC on Base (from Ethereum) */
  USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  /** Aerodrome Finance token */
  AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  /** Coinbase Wrapped Staked ETH */
  cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  /** DAI Stablecoin on Base */
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
} as const

/** Token symbol to address mapping */
export type TokenSymbol = keyof typeof TOKEN_ADDRESSES

/** Token metadata including decimals */
export interface TokenMetadata {
  symbol: TokenSymbol
  address: string
  decimals: number
  name: string
  isStablecoin: boolean
}

/** Complete token metadata */
export const TOKEN_METADATA: Record<TokenSymbol, TokenMetadata> = {
  WETH: {
    symbol: 'WETH',
    address: TOKEN_ADDRESSES.WETH,
    decimals: 18,
    name: 'Wrapped Ether',
    isStablecoin: false,
  },
  USDC: {
    symbol: 'USDC',
    address: TOKEN_ADDRESSES.USDC,
    decimals: 6,
    name: 'USD Coin',
    isStablecoin: true,
  },
  USDbC: {
    symbol: 'USDbC',
    address: TOKEN_ADDRESSES.USDbC,
    decimals: 6,
    name: 'Bridged USD Coin',
    isStablecoin: true,
  },
  AERO: {
    symbol: 'AERO',
    address: TOKEN_ADDRESSES.AERO,
    decimals: 18,
    name: 'Aerodrome Finance',
    isStablecoin: false,
  },
  cbETH: {
    symbol: 'cbETH',
    address: TOKEN_ADDRESSES.cbETH,
    decimals: 18,
    name: 'Coinbase Wrapped Staked ETH',
    isStablecoin: false,
  },
  DAI: {
    symbol: 'DAI',
    address: TOKEN_ADDRESSES.DAI,
    decimals: 18,
    name: 'Dai Stablecoin',
    isStablecoin: true,
  },
}

/**
 * Resolve token symbol or address to metadata
 * @param tokenOrAddress - Token symbol (e.g., "WETH") or address
 * @returns Token metadata or undefined if not found
 */
export function resolveToken(tokenOrAddress: string): TokenMetadata | undefined {
  // Check if it's a known symbol
  const upperToken = tokenOrAddress.toUpperCase() as TokenSymbol
  if (TOKEN_METADATA[upperToken]) {
    return TOKEN_METADATA[upperToken]
  }

  // Check if it's a known address
  const lowerAddress = tokenOrAddress.toLowerCase()
  for (const metadata of Object.values(TOKEN_METADATA)) {
    if (metadata.address.toLowerCase() === lowerAddress) {
      return metadata
    }
  }

  return undefined
}

/**
 * Check if two tokens should use a stable pool
 * @param tokenA - First token symbol or address
 * @param tokenB - Second token symbol or address
 * @returns True if both tokens are stablecoins (should use stable pool)
 */
export function shouldUseStablePool(tokenA: string, tokenB: string): boolean {
  const metadataA = resolveToken(tokenA)
  const metadataB = resolveToken(tokenB)

  if (!metadataA || !metadataB) {
    return false
  }

  return metadataA.isStablecoin && metadataB.isStablecoin
}

/**
 * Get the default trading pairs for the agent
 * These are high-liquidity pairs on Aerodrome
 */
export const DEFAULT_TRADING_PAIRS = [
  { base: 'USDC', quote: 'WETH' },
  { base: 'USDC', quote: 'AERO' },
  { base: 'WETH', quote: 'AERO' },
  { base: 'USDC', quote: 'cbETH' },
] as const
