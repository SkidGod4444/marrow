ALTER TABLE "items" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_ns_url_uq" ON "sources" USING btree ("namespace_id","url");