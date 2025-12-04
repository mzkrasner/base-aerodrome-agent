# Aerodrome Trading Agent

An autonomous spot trading agent for [Aerodrome DEX](https://aerodrome.finance/) on Base chain, built with the [Mastra](https://mastra.ai) AI framework.

## 🎯 What This Does

This agent autonomously trades tokens on Aerodrome DEX by:

1. **Gathering data** - Token prices, pool liquidity, X/Twitter sentiment
2. **Reasoning about it** - The AI agent interprets what the data means
3. **Making decisions** - BUY, SELL, or HOLD based on its analysis
4. **Executing trades** - Swaps tokens on Aerodrome when confident
5. **Learning from outcomes** - Logs decisions and tracks retrospective performance

## 🧠 Architecture: The Agentic Pattern

This project follows the **correct agentic pattern** where the LLM does the work, not hardcoded logic:

```
┌─────────────────────────────────────────────────────────────┐
│                     TRADING LOOP                            │
├─────────────────────────────────────────────────────────────┤
│  1. Load recent trading history from database               │
│  2. Call agent.generate() with context                      │
│  3. Agent calls tools iteratively until confident           │
│  4. Agent returns decision (BUY/SELL/HOLD)                  │
│  5. Log decision to database                                │
│  6. Execute swap if BUY/SELL                                │
│  7. Wait for next iteration                                 │
└─────────────────────────────────────────────────────────────┘
```

**Key principle**: Tools return **raw data**. The agent **interprets** what it means.

### Tools (Data Gathering)

| Tool                  | Purpose                       | Returns                     |
| --------------------- | ----------------------------- | --------------------------- |
| `getQuote`            | Swap quotes from Aerodrome    | Input/output amounts, route |
| `getPoolMetrics`      | Pool reserves and config      | Raw reserves, stable flag   |
| `getTokenPrice`       | Token prices from DexScreener | Price, 24h change, volume   |
| `getWalletBalance`    | Current wallet balances       | ETH and token amounts       |
| `getTwitterSentiment` | X/Twitter observations        | Themes, sentiment velocity  |
| `executeSwap`         | Execute trades                | Transaction hash, status    |

### Database (Persistence)

| Table                 | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `trading_diary`       | Every decision with reasoning (like diary.jsonl) |
| `swap_transactions`   | Executed swaps with on-chain data                |
| `portfolio_snapshots` | Balance history for performance tracking         |
| `price_history`       | Cached prices for retrospective analysis         |

## 📁 Project Structure

```
src/
├── agents/
│   └── trading.agent.ts    # Single autonomous agent with system prompt
├── tools/
│   ├── aerodrome/          # DEX tools (quote, pool, swap)
│   ├── market/             # Price and balance tools
│   └── sentiment/          # X/Twitter sentiment tool
├── loop/
│   └── trading-loop.ts     # Simple loop calling agent.generate()
├── database/
│   ├── schema/trading/     # Drizzle schema for trading data
│   └── repositories/       # Data access methods
├── config/
│   ├── tokens.ts           # Token addresses and metadata
│   └── contracts.ts        # Aerodrome contract ABIs
├── execution/
│   └── wallet.ts           # Wallet and signing utilities
└── index.ts                # Application entry point
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Base chain RPC (public or private)

### Installation

```bash
# Clone and install
git clone <repository>
cd mastra-aerodrome
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Setup database
npm run db:generate
npm run db:migrate
```

### Configuration

Create a `.env` file with:

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/dbname
ANTHROPIC_API_KEY=sk-ant-...

# Optional - Trading (without this, agent runs in read-only mode)
AGENT_PRIVATE_KEY=0x...
BASE_RPC_URL=https://mainnet.base.org

# Optional - Enhanced data
GROK_API_KEY=...   # For X/Twitter sentiment
```

### Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start

# Single iteration (for testing)
npm run cli
```

## 🔧 How It Works

### 1. Agent System Prompt

The agent receives a **glossary** explaining what data means, not instructions on how to interpret it:

```
## Data Glossary (interpret as you see fit)

### Pool Data
• reserve: Amount of each token in the pool
• isStable: Whether pool uses stable swap curve

### Sentiment Observations
• sentiment_velocity: How sentiment is changing (15min, 1hr shifts)
• whale_activity: Large transfers mentioned
Note: Sentiment velocity shifts often lead price by 15-60 minutes
```

### 2. Trading Loop

Each iteration:

1. Fetches recent history from `trading_diary` table
2. Formats it for context: "Last time I bought AERO at $1.50, it went to $1.45"
3. Calls `agent.generate()` with `maxSteps: 10`
4. Agent calls tools until it decides it has enough info
5. Agent returns JSON with `reasoning` and `trade_decisions`
6. Decision logged to database with full context snapshot

### 3. Retrospective Learning

The diary stores `priceAfter1h`, `priceAfter4h`, `priceAfter24h` fields that get filled in later. This allows the agent to see outcomes of past decisions:

```
[2024-12-04T10:00:00Z] AERO/USDC: BUY $50 | 1h later: $1.45 (was $1.50)
```

## 🔐 Security

- Private key is only used for signing, never logged
- All trades go through Aerodrome's audited Router contract
- Slippage protection on all swaps
- Database stores reasoning for audit trail

## 📊 Supported Tokens

Default trading pairs (configurable in `src/config/index.ts`):

- AERO/USDC
- WETH/USDC

Supported tokens:

- WETH, USDC, AERO, cbETH, USDbC, DAI, DEGEN, BRETT

## 🛠️ Development

```bash
# Database commands
npm run db:generate    # Generate new migrations
npm run db:migrate     # Apply migrations
npm run db:studio      # Open Drizzle Studio

# Mastra commands
npm run mastra:dev     # Mastra development server
```

## 📄 License

MIT

---

Built with [Mastra](https://mastra.ai) and Claude Sonnet 4 on Base chain.
