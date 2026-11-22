CREATE TYPE "public"."mc_governance" AS ENUM('public', 'invite_only', 'offline');--> statement-breakpoint
CREATE TYPE "public"."mc_letter_status" AS ENUM('draft', 'pending_review', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."mc_staff_role" AS ENUM('church_owner', 'mission_lead', 'editor', 'reviewer', 'access_reviewer', 'security_auditor', 'finance_link_manager', 'support');--> statement-breakpoint
CREATE TYPE "public"."mc_visibility" AS ENUM('public', 'restricted');--> statement-breakpoint
CREATE TABLE "mc_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"missionary_id" uuid NOT NULL,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_access_grants_user_id_missionary_id_unique" UNIQUE("user_id","missionary_id")
);
--> statement-breakpoint
CREATE TABLE "mc_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"missionary_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"reason_code" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_admin_action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"resource_id" uuid,
	"missionary_id" uuid,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"expected_revision" integer NOT NULL,
	"proposed_change" jsonb NOT NULL,
	"reason_code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_admin_action_requests_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "action_distinct_approver" CHECK ("mc_admin_action_requests"."approved_by" IS NULL OR "mc_admin_action_requests"."approved_by" <> "mc_admin_action_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "mc_admin_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid,
	"missionary_id" uuid,
	"category" text NOT NULL,
	"safe_summary" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"aal" text DEFAULT 'aal1' NOT NULL,
	"session_version" integer NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mc_admin_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text NOT NULL,
	"last_totp_step" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_admin_identities_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "mc_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" uuid,
	"missionary_id" uuid,
	"request_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_delivery_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "mc_donation_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"official_url" text NOT NULL,
	"approved_domain" text NOT NULL,
	"approved_note" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donation_distinct_approver" CHECK ("mc_donation_destinations"."approved_by" IS NULL OR "mc_donation_destinations"."approved_by" <> "mc_donation_destinations"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "mc_letter_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"private_storage_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"sanitized_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_letter_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"encrypted_raw" text NOT NULL,
	"encrypted_ai_draft" text,
	"external_ai_allowed" boolean DEFAULT false NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_letter_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_letter_reviews_letter_id_revision_reviewer_id_unique" UNIQUE("letter_id","revision","reviewer_id")
);
--> statement-breakpoint
CREATE TABLE "mc_letter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"editor_id" uuid NOT NULL,
	"encrypted_snapshot" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_letter_revisions_letter_id_revision_unique" UNIQUE("letter_id","revision")
);
--> statement-breakpoint
CREATE TABLE "mc_prayer_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"missionary_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"status" "mc_letter_status" DEFAULT 'draft' NOT NULL,
	"visibility" "mc_visibility" DEFAULT 'restricted' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"safe_summary" text,
	"prayer_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_line_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"sub_hash" text NOT NULL,
	"encrypted_sub" text,
	"friend_eligible" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_line_identities_provider_sub_hash_unique" UNIQUE("provider","sub_hash")
);
--> statement-breakpoint
CREATE TABLE "mc_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "mc_login_challenges_nonce_hash_unique" UNIQUE("nonce_hash")
);
--> statement-breakpoint
CREATE TABLE "mc_missionaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"overview" text,
	"general_region" text,
	"governance" "mc_governance" DEFAULT 'invite_only' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"allow_photos" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_evidence" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_missionaries_code_unique" UNIQUE("code"),
	CONSTRAINT "offline_no_details" CHECK ("mc_missionaries"."governance" <> 'offline' OR ("mc_missionaries"."overview" IS NULL AND "mc_missionaries"."general_region" IS NULL AND "mc_missionaries"."consent_evidence" IS NULL AND "mc_missionaries"."active" = false))
);
--> statement-breakpoint
CREATE TABLE "mc_missionary_secrets" (
	"missionary_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_details" text NOT NULL,
	"delete_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_prayer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"prayed_on" date DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_prayer_events_user_id_letter_id_prayed_on_unique" UNIQUE("user_id","letter_id","prayed_on")
);
--> statement-breakpoint
CREATE TABLE "mc_privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"assignee_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_security_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"missionary_id" uuid,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason_code" text NOT NULL,
	"reported_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "mc_staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"role" "mc_staff_role" NOT NULL,
	"missionary_id" uuid,
	"approved_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"missionary_id" uuid NOT NULL,
	"following" boolean DEFAULT false NOT NULL,
	"push_opt_in" boolean DEFAULT false NOT NULL,
	"push_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_subscriptions_user_id_missionary_id_unique" UNIQUE("user_id","missionary_id")
);
--> statement-breakpoint
CREATE TABLE "mc_system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"value" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"notice_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mc_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_webhook_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "mc_access_grants" ADD CONSTRAINT "mc_access_grants_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_access_grants" ADD CONSTRAINT "mc_access_grants_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_access_grants" ADD CONSTRAINT "mc_access_grants_approved_by_mc_admin_identities_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_access_requests" ADD CONSTRAINT "mc_access_requests_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_access_requests" ADD CONSTRAINT "mc_access_requests_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_access_requests" ADD CONSTRAINT "mc_access_requests_decided_by_mc_admin_identities_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_action_requests" ADD CONSTRAINT "mc_admin_action_requests_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_action_requests" ADD CONSTRAINT "mc_admin_action_requests_requested_by_mc_admin_identities_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_action_requests" ADD CONSTRAINT "mc_admin_action_requests_approved_by_mc_admin_identities_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_alerts" ADD CONSTRAINT "mc_admin_alerts_admin_id_mc_admin_identities_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_alerts" ADD CONSTRAINT "mc_admin_alerts_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_admin_sessions" ADD CONSTRAINT "mc_admin_sessions_admin_id_mc_admin_identities_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_audit_events" ADD CONSTRAINT "mc_audit_events_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_delivery_jobs" ADD CONSTRAINT "mc_delivery_jobs_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_delivery_jobs" ADD CONSTRAINT "mc_delivery_jobs_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_donation_destinations" ADD CONSTRAINT "mc_donation_destinations_requested_by_mc_admin_identities_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_donation_destinations" ADD CONSTRAINT "mc_donation_destinations_approved_by_mc_admin_identities_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_assets" ADD CONSTRAINT "mc_letter_assets_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_drafts" ADD CONSTRAINT "mc_letter_drafts_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_reviews" ADD CONSTRAINT "mc_letter_reviews_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_reviews" ADD CONSTRAINT "mc_letter_reviews_reviewer_id_mc_admin_identities_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_revisions" ADD CONSTRAINT "mc_letter_revisions_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_letter_revisions" ADD CONSTRAINT "mc_letter_revisions_editor_id_mc_admin_identities_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_prayer_letters" ADD CONSTRAINT "mc_prayer_letters_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_prayer_letters" ADD CONSTRAINT "mc_prayer_letters_author_id_mc_admin_identities_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_line_identities" ADD CONSTRAINT "mc_line_identities_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_missionary_secrets" ADD CONSTRAINT "mc_missionary_secrets_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_prayer_events" ADD CONSTRAINT "mc_prayer_events_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_prayer_events" ADD CONSTRAINT "mc_prayer_events_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_privacy_requests" ADD CONSTRAINT "mc_privacy_requests_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_review_tasks" ADD CONSTRAINT "mc_review_tasks_letter_id_mc_prayer_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."mc_prayer_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_review_tasks" ADD CONSTRAINT "mc_review_tasks_assignee_id_mc_admin_identities_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_security_incidents" ADD CONSTRAINT "mc_security_incidents_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_security_incidents" ADD CONSTRAINT "mc_security_incidents_reported_by_mc_admin_identities_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_sessions" ADD CONSTRAINT "mc_sessions_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_staff_assignments" ADD CONSTRAINT "mc_staff_assignments_admin_id_mc_admin_identities_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_staff_assignments" ADD CONSTRAINT "mc_staff_assignments_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_staff_assignments" ADD CONSTRAINT "mc_staff_assignments_approved_by_mc_admin_identities_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."mc_admin_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_subscriptions" ADD CONSTRAINT "mc_subscriptions_user_id_mc_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."mc_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_subscriptions" ADD CONSTRAINT "mc_subscriptions_missionary_id_mc_missionaries_id_fk" FOREIGN KEY ("missionary_id") REFERENCES "public"."mc_missionaries"("id") ON DELETE no action ON UPDATE no action;