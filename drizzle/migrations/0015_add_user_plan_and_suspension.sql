CREATE TYPE "public"."user_plan" AS ENUM('free', 'premium');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "planExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspendedAt" timestamp with time zone;