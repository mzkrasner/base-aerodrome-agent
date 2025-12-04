/**
 * Drizzle relations for trading tables
 */
import { relations } from 'drizzle-orm'

import { swapTransactions, tradingDiary } from './defs.js'

export const tradingDiaryRelations = relations(tradingDiary, ({ many }) => ({
  swaps: many(swapTransactions),
}))

export const swapTransactionsRelations = relations(swapTransactions, ({ one }) => ({
  diaryEntry: one(tradingDiary, {
    fields: [swapTransactions.diaryId],
    references: [tradingDiary.id],
  }),
}))
