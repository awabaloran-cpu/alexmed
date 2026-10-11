ALTER TABLE "study_room_messages" ADD COLUMN "videoSeconds" integer;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD COLUMN "contentType" varchar(8) DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD COLUMN "youtubeVideoId" varchar(16);--> statement-breakpoint
ALTER TABLE "study_rooms" ADD COLUMN "youtubeTitle" text;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD COLUMN "youtubeState" jsonb;