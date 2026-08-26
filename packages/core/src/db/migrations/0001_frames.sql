CREATE TABLE "frames" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"t" real NOT NULL,
	"s3_key" text NOT NULL,
	"caption" text,
	"ocr_text" text,
	"scene_score" real
);
--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frames_item_t_idx" ON "frames" USING btree ("item_id","t");