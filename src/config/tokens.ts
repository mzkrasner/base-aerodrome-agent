/**
 * Token Configuration for Aerodrome Trading on Base Chain
 * Contains addresses and metadata for tradeable tokens
 */

/** Base chain token addresses */
export const TOKEN_ADDRESSES = {
  // === Core tokens ===
  /** Wrapped ETH on Base */
  WETH: '0x4200000000000000000000000000000000000006',
  /** USDC on Base (native, not bridged) */
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  /** Bridged USDC on Base (from Ethereum) */
  USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  /** DAI Stablecoin on Base */
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',

  // === DeFi tokens ===
  /** Aerodrome Finance token */
  AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  /** Coinbase Wrapped Staked ETH */
  cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  /** Coinbase Wrapped BTC */
  cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  /** Wrapped BTC on Base */
  WBTC: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
  /** Virtual Protocol - AI agents platform */
  VIRTUAL: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
  /** Eigen - restaking protocol token */
  EIGEN: '0x2081ab0d9ec9e4303234ab26d86b20b3367946ee',

  // === Community/Meme tokens ===
  /** Based Brett - top meme coin on Base */
  BRETT: '0x532f27101965dd16442E59d40670FaF5eBB142E4',
  /** Degen - Farcaster community token */
  DEGEN: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
  /** Toshi - Base native meme coin */
  TOSHI: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
  /** Mr Miggles - Base meme coin */
  MIGGLES: '0xB1a03EdA10342529bBF8EB700a06C60441fEf25d',
  /** Ponke - Base meme coin */
  PONKE: '0x4a0c64af541439898448659aedcec8e8e819fc53',
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
  // Core tokens
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
  DAI: {
    symbol: 'DAI',
    address: TOKEN_ADDRESSES.DAI,
    decimals: 18,
    name: 'Dai Stablecoin',
    isStablecoin: true,
  },

  // DeFi tokens
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
  cbBTC: {
    symbol: 'cbBTC',
    address: TOKEN_ADDRESSES.cbBTC,
    decimals: 8,
    name: 'Coinbase Wrapped BTC',
    isStablecoin: false,
  },
  WBTC: {
    symbol: 'WBTC',
    address: TOKEN_ADDRESSES.WBTC,
    decimals: 8,
    name: 'Wrapped BTC',
    isStablecoin: false,
  },
  VIRTUAL: {
    symbol: 'VIRTUAL',
    address: TOKEN_ADDRESSES.VIRTUAL,
    decimals: 18,
    name: 'Virtual Protocol',
    isStablecoin: false,
  },
  EIGEN: {
    symbol: 'EIGEN',
    address: TOKEN_ADDRESSES.EIGEN,
    decimals: 18,
    name: 'Eigen',
    isStablecoin: false,
  },

  // Community/Meme tokens
  BRETT: {
    symbol: 'BRETT',
    address: TOKEN_ADDRESSES.BRETT,
    decimals: 18,
    name: 'Based Brett',
    isStablecoin: false,
  },
  DEGEN: {
    symbol: 'DEGEN',
    address: TOKEN_ADDRESSES.DEGEN,
    decimals: 18,
    name: 'Degen',
    isStablecoin: false,
  },
  TOSHI: {
    symbol: 'TOSHI',
    address: TOKEN_ADDRESSES.TOSHI,
    decimals: 18,
    name: 'Toshi',
    isStablecoin: false,
  },
  MIGGLES: {
    symbol: 'MIGGLES',
    address: TOKEN_ADDRESSES.MIGGLES,
    decimals: 18,
    name: 'Mr Miggles',
    isStablecoin: false,
  },
  PONKE: {
    symbol: 'PONKE',
    address: TOKEN_ADDRESSES.PONKE,
    decimals: 18,
    name: 'Ponke',
    isStablecoin: false,
  },
}

/**
 * Resolve token symbol or address to metadata
 * @param tokenOrAddress - Token symbol (e.g., "WETH") or address
 * @returns Token metadata or undefined if not found
 */
export function resolveToken(tokenOrAddress: string): TokenMetadata | undefined {
  // Check if it's a known symbol (case-insensitive lookup)
  const inputUpper = tokenOrAddress.toUpperCase()
  for (const [key, metadata] of Object.entries(TOKEN_METADATA)) {
    if (key.toUpperCase() === inputUpper) {
      return metadata
    }
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
  // Core DeFi pairs
  { base: 'USDC', quote: 'WETH' },
  { base: 'USDC', quote: 'AERO' },
  { base: 'WETH', quote: 'AERO' },
  { base: 'USDC', quote: 'cbETH' },
  { base: 'USDC', quote: 'cbBTC' },
  { base: 'WETH', quote: 'cbBTC' },

  // AI/Protocol tokens
  { base: 'WETH', quote: 'VIRTUAL' },

  // Community/Meme tokens (high volume)
  { base: 'WETH', quote: 'BRETT' },
  { base: 'WETH', quote: 'DEGEN' },
  { base: 'WETH', quote: 'TOSHI' },
] as const
