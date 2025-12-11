/**
 * Database schema exports
 * Aerodrome DEX trading schema + EigenAI verification schema
 */
import * as eigenaiDefs from './eigenai/defs.js'
import * as tradingDefs from './trading/defs.js'
import * as tradingRelations from './trading/relations.js'

const schema = {
  ...tradingDefs,
  ...tradingRelations,
  ...eigenaiDefs,
}

export default schema

// Export types and table definitions
export * from './trading/types.js'
export * from './trading/defs.js'
export * from './eigenai/types.js'
export * from './eigenai/defs.js'
