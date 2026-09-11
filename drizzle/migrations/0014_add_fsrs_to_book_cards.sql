ALTER TYPE "public"."book_card_rating" ADD VALUE 'again';--> statement-breakpoint
ALTER TABLE "book_cards" ADD COLUMN "fsrsStability" real;--> statement-breakpoint
ALTER TABLE "book_cards" ADD COLUMN "fsrsDifficulty" real;--> statement-breakpoint
ALTER TABLE "book_cards" ADD COLUMN "lastReviewedAt" timestamp with time zone;