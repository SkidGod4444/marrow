CREATE TABLE "expression_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"n" integer NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"explanation" text NOT NULL,
	"t_start" real NOT NULL,
	"t_end" real NOT NULL,
	"clip_key" text,
	"stage" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"last_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expression_reviews" ADD CONSTRAINT "expression_reviews_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expression_reviews_item_n_uq" ON "expression_reviews" USING btree ("item_id","n");--> statement-breakpoint
CREATE INDEX "expression_reviews_due_idx" ON "expression_reviews" USING btree ("due_at");