/**
 * Database schema exports
 * Aerodrome DEX trading schema
 */
import * as tradingDefs from './trading/defs.js'
import * as tradingRelations from './trading/relations.js'

const schema = {
  ...tradingDefs,
  ...tradingRelations,
}

export default schema

// Export types and table definitions
export * from './trading/types.js'
export * from './trading/defs.js'
