CREATE TYPE "public"."book_mcq_validation_status" AS ENUM('pending', 'valid', 'flagged');--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "validationStatus" "book_mcq_validation_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "validationNote" text;