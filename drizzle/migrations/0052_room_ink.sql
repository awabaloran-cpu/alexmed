ALTER TABLE "study_room_marks" ADD COLUMN "kind" varchar(12) DEFAULT 'rect' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_room_marks" ADD COLUMN "points" jsonb;--> statement-breakpoint
ALTER TABLE "study_room_marks" ADD COLUMN "width" real;