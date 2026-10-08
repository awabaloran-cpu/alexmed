CREATE TABLE "file_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bookId" uuid NOT NULL,
	"ownerId" uuid NOT NULL,
	"code" varchar(24) NOT NULL,
	"joinCount" integer DEFAULT 0 NOT NULL,
	"reportCount" integer DEFAULT 0 NOT NULL,
	"lastReportedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"revokedBy" varchar(8),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_shares" ADD COLUMN "linkId" uuid;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_links" ADD CONSTRAINT "file_share_links_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_share_links_code_idx" ON "file_share_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "file_share_links_book_idx" ON "file_share_links" USING btree ("bookId");--> statement-breakpoint
CREATE UNIQUE INDEX "file_share_links_live_book_idx" ON "file_share_links" USING btree ("bookId") WHERE "file_share_links"."revokedAt" is null;--> statement-breakpoint
ALTER TABLE "book_shares" ADD CONSTRAINT "book_shares_linkId_file_share_links_id_fk" FOREIGN KEY ("linkId") REFERENCES "public"."file_share_links"("id") ON DELETE set null ON UPDATE no action;