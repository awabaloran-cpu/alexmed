CREATE TABLE "file_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"bookId" uuid NOT NULL,
	"telegramAccountId" uuid,
	"style" varchar(16) NOT NULL,
	"theme" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"sourcePages" integer DEFAULT 0 NOT NULL,
	"donePages" integer DEFAULT 0 NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text,
	"fileKey" text,
	"error" text,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"statusMessageId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_summaries" ADD CONSTRAINT "file_summaries_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_summaries" ADD CONSTRAINT "file_summaries_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_summaries" ADD CONSTRAINT "file_summaries_telegramAccountId_telegram_accounts_id_fk" FOREIGN KEY ("telegramAccountId") REFERENCES "public"."telegram_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_summaries_user_created_idx" ON "file_summaries" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "file_summaries_book_idx" ON "file_summaries" USING btree ("bookId");