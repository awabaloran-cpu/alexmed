ALTER TABLE "book_cards" ADD COLUMN "knowledgeItemId" uuid;--> statement-breakpoint
ALTER TABLE "book_cards" ADD COLUMN "sourcePages" jsonb;--> statement-breakpoint
ALTER TABLE "book_cards" ADD COLUMN "cardType" text;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "knowledgeItemId" uuid;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "relatedKnowledgeItemIds" jsonb;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "sourcePages" jsonb;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD COLUMN "questionType" text;--> statement-breakpoint
ALTER TABLE "book_cards" ADD CONSTRAINT "book_cards_knowledgeItemId_exam_focus_cards_id_fk" FOREIGN KEY ("knowledgeItemId") REFERENCES "public"."exam_focus_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_mcqs" ADD CONSTRAINT "book_mcqs_knowledgeItemId_exam_focus_cards_id_fk" FOREIGN KEY ("knowledgeItemId") REFERENCES "public"."exam_focus_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_cards_knowledge_item_id_idx" ON "book_cards" USING btree ("knowledgeItemId");