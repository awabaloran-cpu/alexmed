CREATE TYPE "public"."book_profile" AS ENUM('general', 'medical', 'english', 'mathematics', 'aptitude', 'programming', 'custom');--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "book_profile" DEFAULT 'general' NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"examDate" timestamp with time zone,
	"targetDate" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "subjectId" uuid;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "profile" "book_profile" DEFAULT 'general' NOT NULL;--> statement-breakpoint
-- Every book that existed before this column was added was created by
-- كتبي's original, medical-exam-only pipeline — backfill them to "medical"
-- (not "general", which is only the default for genuinely new books from
-- here on). At this point in the migration every existing row was just
-- written to 'general' by the ADD COLUMN ... DEFAULT above, so this WHERE
-- clause safely means "every pre-existing row", nothing more.
UPDATE "books" SET "profile" = 'medical' WHERE "profile" = 'general';--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subjects_user_id_created_at_idx" ON "subjects" USING btree ("userId","createdAt");--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_subjectId_subjects_id_fk" FOREIGN KEY ("subjectId") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;