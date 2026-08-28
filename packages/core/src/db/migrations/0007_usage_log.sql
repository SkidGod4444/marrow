CREATE TABLE "usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text,
	"namespace_id" text,
	"user_id" text,
	"job_id" text,
	"source" text NOT NULL,
	"stage" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" double precision DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_log_item_idx" ON "usage_log" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "usage_log_ns_idx" ON "usage_log" USING btree ("namespace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_log_job_stage_model_uq" ON "usage_log" USING btree ("job_id","stage","model");