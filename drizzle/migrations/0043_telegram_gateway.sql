CREATE TABLE "access_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"userId" uuid NOT NULL,
	"path" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"usedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid,
	"bookId" uuid,
	"provider" varchar(24) NOT NULL,
	"slot" varchar(32) NOT NULL,
	"event" varchar(16) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"bookId" uuid NOT NULL,
	"questionId" uuid NOT NULL,
	"selectedIndex" integer NOT NULL,
	"isCorrect" boolean,
	"answeredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegramUserId" bigint NOT NULL,
	"chatId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"languageCode" varchar(12),
	"pendingKind" varchar(16),
	"blockedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegramAccountId" uuid NOT NULL,
	"updateId" bigint NOT NULL,
	"fileId" text NOT NULL,
	"fileUniqueId" varchar(128) NOT NULL,
	"fileName" text NOT NULL,
	"fileSize" integer NOT NULL,
	"requestedKind" varchar(16),
	"kind" varchar(16),
	"fileKey" text,
	"bookId" uuid,
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"error" text,
	"statusMessageId" integer,
	"lastStage" varchar(64),
	"watchCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extracted_questions" ADD COLUMN "mnemonicAr" text;--> statement-breakpoint
ALTER TABLE "access_link_tokens" ADD CONSTRAINT "access_link_tokens_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_questionId_extracted_questions_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."extracted_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_uploads" ADD CONSTRAINT "telegram_uploads_telegramAccountId_telegram_accounts_id_fk" FOREIGN KEY ("telegramAccountId") REFERENCES "public"."telegram_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_uploads" ADD CONSTRAINT "telegram_uploads_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_link_tokens_token_hash_idx" ON "access_link_tokens" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "access_link_tokens_user_idx" ON "access_link_tokens" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "access_link_tokens_expires_idx" ON "access_link_tokens" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "ad_events_created_idx" ON "ad_events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "ad_events_provider_event_idx" ON "ad_events" USING btree ("provider","event","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "question_attempts_user_question_idx" ON "question_attempts" USING btree ("userId","questionId");--> statement-breakpoint
CREATE INDEX "question_attempts_user_book_idx" ON "question_attempts" USING btree ("userId","bookId");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_telegram_user_idx" ON "telegram_accounts" USING btree ("telegramUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_accounts_user_idx" ON "telegram_accounts" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_uploads_update_idx" ON "telegram_uploads" USING btree ("updateId");--> statement-breakpoint
CREATE INDEX "telegram_uploads_account_created_idx" ON "telegram_uploads" USING btree ("telegramAccountId","createdAt");--> statement-breakpoint
CREATE INDEX "telegram_uploads_account_file_idx" ON "telegram_uploads" USING btree ("telegramAccountId","fileUniqueId");--> statement-breakpoint
CREATE INDEX "telegram_uploads_book_idx" ON "telegram_uploads" USING btree ("bookId");--> statement-breakpoint
CREATE INDEX "telegram_uploads_created_idx" ON "telegram_uploads" USING btree ("createdAt");