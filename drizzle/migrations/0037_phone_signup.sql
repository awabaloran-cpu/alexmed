CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"purpose" text DEFAULT 'signup' NOT NULL,
	"providerRequestId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ipHash" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"verifiedAt" timestamp with time zone,
	"consumedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phoneVerifiedAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "phone_verifications_phone_created_at_idx" ON "phone_verifications" USING btree ("phone","createdAt");--> statement-breakpoint
CREATE INDEX "phone_verifications_ip_created_at_idx" ON "phone_verifications" USING btree ("ipHash","createdAt");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");