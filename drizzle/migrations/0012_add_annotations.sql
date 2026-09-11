CREATE TYPE "public"."annotation_type" AS ENUM('highlight', 'note');--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"bookId" uuid NOT NULL,
	"pageId" uuid NOT NULL,
	"type" "annotation_type" NOT NULL,
	"selectedText" text,
	"positionJson" jsonb,
	"content" text DEFAULT '' NOT NULL,
	"color" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_pageId_book_pages_id_fk" FOREIGN KEY ("pageId") REFERENCES "public"."book_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_page_id_idx" ON "annotations" USING btree ("pageId");--> statement-breakpoint
CREATE INDEX "annotations_user_id_book_id_idx" ON "annotations" USING btree ("userId","bookId");