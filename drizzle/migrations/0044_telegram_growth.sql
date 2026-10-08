ALTER TABLE "telegram_accounts" ADD COLUMN "source" varchar(40);--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD COLUMN "referralCode" varchar(16);--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD COLUMN "referredById" uuid;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD COLUMN "referralRewardedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD COLUMN "bonusUploads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD COLUMN "bonusUsed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_referredById_telegram_accounts_id_fk" FOREIGN KEY ("referredById") REFERENCES "public"."telegram_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_referral_code_idx" ON "telegram_accounts" USING btree ("referralCode");--> statement-breakpoint
CREATE INDEX "telegram_accounts_source_idx" ON "telegram_accounts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "telegram_accounts_referred_by_idx" ON "telegram_accounts" USING btree ("referredById");