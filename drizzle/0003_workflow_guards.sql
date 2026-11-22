CREATE FUNCTION mc_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable record'; END $$;
--> statement-breakpoint
CREATE TRIGGER mc_revision_immutable BEFORE UPDATE OR DELETE ON mc_letter_revisions FOR EACH ROW EXECUTE FUNCTION mc_immutable_record();
--> statement-breakpoint
CREATE TRIGGER mc_review_immutable BEFORE UPDATE OR DELETE ON mc_letter_reviews FOR EACH ROW EXECUTE FUNCTION mc_immutable_record();
--> statement-breakpoint
CREATE TRIGGER mc_audit_immutable BEFORE UPDATE OR DELETE ON mc_audit_events FOR EACH ROW EXECUTE FUNCTION mc_immutable_record();
--> statement-breakpoint
CREATE INDEX mc_jobs_status_schedule ON mc_delivery_jobs (status, scheduled_at);
--> statement-breakpoint
CREATE INDEX mc_letters_scope_status ON mc_prayer_letters (missionary_id, status);
--> statement-breakpoint
INSERT INTO mc_system_settings (key, enabled, value) VALUES ('ai_import_disabled', false, null), ('monthly_notification_quota', false, '0');
