/**
 * Aerodrome Contract Configuration for Base Chain
 * Contains contract addresses and ABIs for DEX interactions
 */

/** Aerodrome contract addresses on Base mainnet */
export const AERODROME_CONTRACTS = {
  /** Router V2 - Main entry point for swaps */
  ROUTER_V2: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  /** Universal Router - Advanced routing */
  UNIVERSAL_ROUTER: '0x6Cb442acF35158D5eDa88fe602221b67B400bE3E',
  /** Voter contract for gauge management */
  VOTER: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5',
  /** Pool Factory for volatile pairs */
  POOL_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
} as const

/** Base chain configuration */
export const BASE_CHAIN = {
  chainId: 8453,
  name: 'Base',
  rpcUrl: 'https://mainnet.base.org',
  blockExplorer: 'https://basescan.org',
} as const

/** Minimal ABI for ERC20 tokens */
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
] as const

/**
 * Aerodrome Router V2 ABI (minimal for swaps)
 * @see https://basescan.org/address/0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43
 */
export const AERODROME_ROUTER_ABI = [
  // Read functions
  'function getAmountsOut(uint amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint[] amounts)',
  'function getReserves(address tokenA, address tokenB, bool stable, address factory) view returns (uint reserveA, uint reserveB)',
  'function poolFor(address tokenA, address tokenB, bool stable, address factory) view returns (address pool)',
  'function factory() view returns (address)',
  'function defaultFactory() view returns (address)',
  'function ETHER() view returns (address)',
  'function weth() view returns (address)',

  // Write functions - Token to Token
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline)',

  // Write functions - ETH to Token
  'function swapExactETHForTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) payable',

  // Write functions - Token to ETH
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint deadline)',
] as const

/**
 * Aerodrome Pool ABI (for getting pool info)
 */
export const AERODROME_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function reserve0() view returns (uint256)',
  'function reserve1() view returns (uint256)',
  'function stable() view returns (bool)',
  'function getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function factory() view returns (address)',
  'function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)',
] as const

/**
 * Route struct for Aerodrome swaps
 * Matches the Solidity struct:
 * struct Route {
 *   address from;      // Input token address
 *   address to;        // Output token address
 *   bool stable;       // true for stable pools, false for volatile pools
 *   address factory;   // Pool factory address (optional, can be address(0))
 * }
 */
export interface AerodromeRoute {
  from: string
  to: string
  stable: boolean
  factory: string
}

/**
 * Create a route for Aerodrome swap
 * @param from - Input token address
 * @param to - Output token address
 * @param stable - Whether to use stable pool (for stablecoin pairs)
 * @param factory - Factory address (use zero address for default)
 */
export function createRoute(
  from: string,
  to: string,
  stable: boolean,
  factory: string = '0x0000000000000000000000000000000000000000'
): AerodromeRoute {
  return { from, to, stable, factory }
}
