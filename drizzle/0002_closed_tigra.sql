CREATE TABLE "mc_admin_user_links" (
	"admin_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "mc_admin_user_links_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "mc_delivery_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "mc_delivery_recipients_letter_id_user_id_unique" UNIQUE("letter_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mc_delivery_usage" (
	"month" text PRIMARY KEY NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_member_submissions" (
	"letter_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_operations" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_submitter_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"missionary_id" uuid NOT NULL,
	"editor_admin_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mc_admin_user_links" ADD CONSTRAINT "mc_admin_user_links_admin_id_mc_admin_identities_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_user_links" ADD CONSTRAINT "mc_admin_user_links_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_delivery_recipients" ADD CONSTRAINT "mc_delivery_recipients_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_delivery_recipients" ADD CONSTRAINT "mc_delivery_recipients_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_member_submissions" ADD CONSTRAINT "mc_member_submissions_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_member_submissions" ADD CONSTRAINT "mc_member_submissions_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_submitter_assignments" ADD CONSTRAINT "mc_submitter_assignments_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_submitter_assignments" ADD CONSTRAINT "mc_submitter_assignments_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_submitter_assignments" ADD CONSTRAINT "mc_submitter_assignments_editor_admin_id_mc_admin_identities_id_fk" FOREIGN KEY ("editor_admin_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;