/**
 * Aerodrome DEX Trading Schema
 *
 * Modeled after ai-trading-agent's diary.jsonl but with real database persistence.
 * Key tables:
 * - tradingDiary: Every decision the agent makes (like diary.jsonl)
 * - swapTransactions: Executed swaps with on-chain data
 * - portfolioSnapshots: Periodic balance snapshots for performance tracking
 */
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestampColumns, uuidColumn } from '../util'

/**
 * Trading Diary
 * Records every decision the agent makes - whether executed or not.
 * This is the primary context for retrospective analysis.
 *
 * Analogous to diary.jsonl in ai-trading-agent
 */
export const tradingDiary = pgTable(
  'trading_diary',
  {
    id: uuidColumn(),

    // Iteration context
    iterationNumber: integer('iteration_number').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    // Token pair
    tokenIn: text('token_in').notNull(), // e.g., "WETH"
    tokenOut: text('token_out').notNull(), // e.g., "AERO"

    // Decision
    action: text('action', { enum: ['BUY', 'SELL', 'HOLD'] }).notNull(),

    // Amounts (null if HOLD)
    amountIn: decimal('amount_in', { precision: 36, scale: 18 }),
    amountOut: decimal('amount_out', { precision: 36, scale: 18 }),
    amountUsd: decimal('amount_usd', { precision: 18, scale: 2 }),

    // Prices at time of decision
    priceAtDecision: decimal('price_at_decision', { precision: 36, scale: 18 }),

    // Agent reasoning (critical for retrospective analysis)
    reasoning: text('reasoning').notNull(),
    rationale: text('rationale'), // Short summary

    // Data the agent saw when making this decision
    contextSnapshot: jsonb('context_snapshot'), // Market data, sentiment, etc.

    // Execution status
    executed: boolean('executed').notNull().default(false),
    txHash: text('tx_hash'),
    executionError: text('execution_error'),

    // Outcome tracking (filled in later for retrospective)
    priceAfter1h: decimal('price_after_1h', { precision: 36, scale: 18 }),
    priceAfter4h: decimal('price_after_4h', { precision: 36, scale: 18 }),
    priceAfter24h: decimal('price_after_24h', { precision: 36, scale: 18 }),
    outcomeNotes: text('outcome_notes'), // Agent's retrospective assessment

    ...timestampColumns(),
  },
  (table) => [
    index('idx_diary_timestamp').on(table.timestamp),
    index('idx_diary_iteration').on(table.iterationNumber),
    index('idx_diary_token_pair').on(table.tokenIn, table.tokenOut),
    index('idx_diary_action').on(table.action),
    index('idx_diary_executed').on(table.executed),
  ]
)

/**
 * Swap Transactions
 * Records executed swaps with on-chain data for accurate PnL tracking.
 */
export const swapTransactions = pgTable(
  'swap_transactions',
  {
    id: uuidColumn(),

    // Link to diary entry
    diaryId: uuid('diary_id').references(() => tradingDiary.id),

    // Transaction data
    txHash: text('tx_hash').notNull().unique(),
    blockNumber: integer('block_number'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    // Swap details
    tokenIn: text('token_in').notNull(),
    tokenInAddress: text('token_in_address').notNull(),
    amountIn: decimal('amount_in', { precision: 36, scale: 18 }).notNull(),
    amountInUsd: decimal('amount_in_usd', { precision: 18, scale: 2 }),

    tokenOut: text('token_out').notNull(),
    tokenOutAddress: text('token_out_address').notNull(),
    amountOut: decimal('amount_out', { precision: 36, scale: 18 }).notNull(),
    amountOutUsd: decimal('amount_out_usd', { precision: 18, scale: 2 }),

    // Execution details
    poolAddress: text('pool_address'),
    isStablePool: boolean('is_stable_pool'),
    slippagePercent: decimal('slippage_percent', { precision: 8, scale: 4 }),

    // Gas costs
    gasUsed: integer('gas_used'),
    gasPriceGwei: decimal('gas_price_gwei', { precision: 12, scale: 4 }),
    gasCostUsd: decimal('gas_cost_usd', { precision: 10, scale: 4 }),

    // Status
    status: text('status', { enum: ['SUCCESS', 'FAILED', 'REVERTED'] }).notNull(),
    errorMessage: text('error_message'),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_swaps_timestamp').on(table.timestamp),
    index('idx_swaps_tokens').on(table.tokenIn, table.tokenOut),
    index('idx_swaps_status').on(table.status),
  ]
)

/**
 * Portfolio Snapshots
 * Periodic snapshots of wallet balances for performance tracking.
 */
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuidColumn(),

    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    iterationNumber: integer('iteration_number'),

    // Balances as JSONB for flexibility
    // Format: { "ETH": "1.5", "WETH": "0.5", "USDC": "1000", "AERO": "500" }
    balances: jsonb('balances').notNull(),

    // Computed totals
    totalValueUsd: decimal('total_value_usd', { precision: 18, scale: 2 }),

    // Performance since start
    startingValueUsd: decimal('starting_value_usd', { precision: 18, scale: 2 }),
    pnlUsd: decimal('pnl_usd', { precision: 18, scale: 2 }),
    pnlPercent: decimal('pnl_percent', { precision: 10, scale: 4 }),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_snapshots_timestamp').on(table.timestamp),
    index('idx_snapshots_iteration').on(table.iterationNumber),
  ]
)

/**
 * Price History Cache
 * Caches token prices for retrospective analysis without hitting external APIs.
 */
export const priceHistory = pgTable(
  'price_history',
  {
    id: uuidColumn(),

    token: text('token').notNull(), // Symbol like "AERO"
    tokenAddress: text('token_address').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    priceUsd: decimal('price_usd', { precision: 36, scale: 18 }).notNull(),
    volume24hUsd: decimal('volume_24h_usd', { precision: 18, scale: 2 }),
    liquidityUsd: decimal('liquidity_usd', { precision: 18, scale: 2 }),

    source: text('source').notNull().default('dexscreener'),

    ...timestampColumns(),
  },
  (table) => [
    index('idx_prices_token_timestamp').on(table.token, table.timestamp),
    index('idx_prices_timestamp').on(table.timestamp),
  ]
)
