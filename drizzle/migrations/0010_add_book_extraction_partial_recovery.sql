CREATE TYPE "public"."book_chapter_detection_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
ALTER TABLE "book_pages" ADD COLUMN "textErrorMessage" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "chapterDetectionConfidence" "book_chapter_detection_confidence";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "ocrAttemptCounts" jsonb;