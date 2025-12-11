CREATE TABLE "eigenai_inferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_prompt" text NOT NULL,
	"response_model" text NOT NULL,
	"response_output" text NOT NULL,
	"signature" text NOT NULL,
	"wallet_address" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"swap_transaction_id" uuid,
	"submitted_to_recall" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"recall_submission_id" uuid,
	"inferred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eigenai_inferences" ADD CONSTRAINT "eigenai_inferences_swap_transaction_id_swap_transactions_id_fk" FOREIGN KEY ("swap_transaction_id") REFERENCES "public"."swap_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_eigenai_submitted" ON "eigenai_inferences" USING btree ("submitted_to_recall");--> statement-breakpoint
CREATE INDEX "idx_eigenai_wallet" ON "eigenai_inferences" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_eigenai_inferred_at" ON "eigenai_inferences" USING btree ("inferred_at");--> statement-breakpoint
CREATE INDEX "idx_eigenai_swap_transaction" ON "eigenai_inferences" USING btree ("swap_transaction_id");