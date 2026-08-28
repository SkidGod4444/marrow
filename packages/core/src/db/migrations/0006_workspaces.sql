CREATE TABLE "auth_apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "auth_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "auth_organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "namespaces" DROP CONSTRAINT "namespaces_name_unique";--> statement-breakpoint
DROP INDEX "expression_reviews_item_n_uq";--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "expression_reviews" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "namespaces" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "auth_invitation" ADD CONSTRAINT "auth_invitation_organization_id_auth_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_invitation" ADD CONSTRAINT "auth_invitation_inviter_id_auth_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_member" ADD CONSTRAINT "auth_member_organization_id_auth_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_member" ADD CONSTRAINT "auth_member_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_apikey_reference_idx" ON "auth_apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "auth_apikey_key_idx" ON "auth_apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "auth_invitation_org_idx" ON "auth_invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auth_invitation_email_idx" ON "auth_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_member_org_idx" ON "auth_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auth_member_user_idx" ON "auth_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_member_org_user_uq" ON "auth_member" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_organization_id_auth_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expression_reviews_user_item_n_uq" ON "expression_reviews" USING btree ("user_id","item_id","n");--> statement-breakpoint
CREATE INDEX "expression_reviews_user_idx" ON "expression_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "namespaces_org_name_uq" ON "namespaces" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "namespaces_org_idx" ON "namespaces" USING btree ("organization_id");