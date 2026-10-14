ALTER TABLE "account_invites" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;