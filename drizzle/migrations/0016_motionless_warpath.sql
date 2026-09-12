CREATE TYPE "public"."book_source_type" AS ENUM('study_book', 'question_file');--> statement-breakpoint
CREATE TABLE "extracted_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bookId" uuid NOT NULL,
	"orderIndex" integer NOT NULL,
	"questionText" text NOT NULL,
	"options" jsonb,
	"extractedAnswerIndex" integer,
	"extractedAnswerText" text,
	"aiInferredAnswerIndex" integer,
	"explanationText" text,
	"sourcePage" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "sourceType" "book_source_type" DEFAULT 'study_book' NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_questions" ADD CONSTRAINT "extracted_questions_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extracted_questions_book_id_order_index_idx" ON "extracted_questions" USING btree ("bookId","orderIndex");