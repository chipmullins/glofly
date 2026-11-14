CREATE INDEX IF NOT EXISTS "automod_held_conversation_idx" ON "automod_held" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_caller_idx" ON "calls" USING btree ("caller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calls_message_idx" ON "calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "constellation_bans_user_idx" ON "constellation_bans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "constellation_events_message_idx" ON "constellation_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "constellation_member_roles_user_idx" ON "constellation_member_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "giveaway_entries_user_idx" ON "giveaway_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glows_user_high_idx" ON "glows" USING btree ("user_high");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nebula_pins_nebula_idx" ON "nebula_pins" USING btree ("nebula_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nicknames_target_idx" ON "nicknames" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pinned_messages_message_idx" ON "pinned_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poll_votes_user_idx" ON "poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_messages_conversation_idx" ON "scheduled_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_people_user_idx" ON "stage_people" USING btree ("user_id");