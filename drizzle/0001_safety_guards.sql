INSERT INTO mc_system_settings (key, enabled) VALUES ('global_notification_pause', true), ('donations', false), ('external_ai', false);
--> statement-breakpoint
CREATE FUNCTION mc_reject_offline_details() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM mc_missionaries WHERE id = NEW.missionary_id AND governance = 'offline') THEN
    RAISE EXCEPTION 'Offline details prohibited';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mc_offline_secrets BEFORE INSERT OR UPDATE ON mc_missionary_secrets FOR EACH ROW EXECUTE FUNCTION mc_reject_offline_details();
--> statement-breakpoint
CREATE TRIGGER mc_offline_letters BEFORE INSERT OR UPDATE ON mc_prayer_letters FOR EACH ROW EXECUTE FUNCTION mc_reject_offline_details();
--> statement-breakpoint
CREATE FUNCTION mc_reject_offline_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.governance = 'offline' AND (EXISTS (SELECT 1 FROM mc_missionary_secrets WHERE missionary_id = NEW.id) OR EXISTS (SELECT 1 FROM mc_prayer_letters WHERE missionary_id = NEW.id)) THEN
    RAISE EXCEPTION 'Remove details before offline transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mc_offline_transition BEFORE UPDATE ON mc_missionaries FOR EACH ROW EXECUTE FUNCTION mc_reject_offline_transition();
