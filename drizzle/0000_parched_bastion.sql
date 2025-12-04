CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"iteration_number" integer,
	"balances" jsonb NOT NULL,
	"total_value_usd" numeric(18, 2),
	"starting_value_usd" numeric(18, 2),
	"pnl_usd" numeric(18, 2),
	"pnl_percent" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"token_address" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price_usd" numeric(36, 18) NOT NULL,
	"volume_24h_usd" numeric(18, 2),
	"liquidity_usd" numeric(18, 2),
	"source" text DEFAULT 'dexscreener' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_id" uuid,
	"tx_hash" text NOT NULL,
	"block_number" integer,
	"timestamp" timestamp with time zone NOT NULL,
	"token_in" text NOT NULL,
	"token_in_address" text NOT NULL,
	"amount_in" numeric(36, 18) NOT NULL,
	"amount_in_usd" numeric(18, 2),
	"token_out" text NOT NULL,
	"token_out_address" text NOT NULL,
	"amount_out" numeric(36, 18) NOT NULL,
	"amount_out_usd" numeric(18, 2),
	"pool_address" text,
	"is_stable_pool" boolean,
	"slippage_percent" numeric(8, 4),
	"gas_used" integer,
	"gas_price_gwei" numeric(12, 4),
	"gas_cost_usd" numeric(10, 4),
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swap_transactions_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "trading_diary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iteration_number" integer NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"token_in" text NOT NULL,
	"token_out" text NOT NULL,
	"action" text NOT NULL,
	"amount_in" numeric(36, 18),
	"amount_out" numeric(36, 18),
	"amount_usd" numeric(18, 2),
	"price_at_decision" numeric(36, 18),
	"reasoning" text NOT NULL,
	"rationale" text,
	"context_snapshot" jsonb,
	"executed" boolean DEFAULT false NOT NULL,
	"tx_hash" text,
	"execution_error" text,
	"price_after_1h" numeric(36, 18),
	"price_after_4h" numeric(36, 18),
	"price_after_24h" numeric(36, 18),
	"outcome_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD CONSTRAINT "swap_transactions_diary_id_trading_diary_id_fk" FOREIGN KEY ("diary_id") REFERENCES "public"."trading_diary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_snapshots_timestamp" ON "portfolio_snapshots" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_snapshots_iteration" ON "portfolio_snapshots" USING btree ("iteration_number");--> statement-breakpoint
CREATE INDEX "idx_prices_token_timestamp" ON "price_history" USING btree ("token","timestamp");--> statement-breakpoint
CREATE INDEX "idx_prices_timestamp" ON "price_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_swaps_timestamp" ON "swap_transactions" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_swaps_tokens" ON "swap_transactions" USING btree ("token_in","token_out");--> statement-breakpoint
CREATE INDEX "idx_swaps_status" ON "swap_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_diary_timestamp" ON "trading_diary" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_diary_iteration" ON "trading_diary" USING btree ("iteration_number");--> statement-breakpoint
CREATE INDEX "idx_diary_token_pair" ON "trading_diary" USING btree ("token_in","token_out");--> statement-breakpoint
CREATE INDEX "idx_diary_action" ON "trading_diary" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_diary_executed" ON "trading_diary" USING btree ("executed");