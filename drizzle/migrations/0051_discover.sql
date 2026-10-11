CREATE TABLE "discover_channel_follows" (
	"channelId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_channel_follows_channelId_userId_pk" PRIMARY KEY("channelId","userId")
);
--> statement-breakpoint
CREATE TABLE "discover_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"language" varchar(2) NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo" text,
	"cover" text,
	"art" varchar(24) DEFAULT 'general' NOT NULL,
	"color" varchar(9) DEFAULT '#2440c7' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_channels_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "discover_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quizId" uuid NOT NULL,
	"orderIndex" integer NOT NULL,
	"text" text NOT NULL,
	"image" text,
	"options" jsonb NOT NULL,
	"correctIndex" integer NOT NULL,
	"timeLimit" integer DEFAULT 20 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discover_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"language" varchar(2) NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"coverImage" text,
	"art" varchar(24) DEFAULT 'general' NOT NULL,
	"color" varchar(9) DEFAULT '#1b2340' NOT NULL,
	"category" varchar(24) NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isFree" boolean DEFAULT true NOT NULL,
	"channelId" uuid,
	"creatorName" text NOT NULL,
	"creatorVerified" boolean DEFAULT false NOT NULL,
	"playsCount" integer DEFAULT 0 NOT NULL,
	"questionsCount" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_quizzes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "discover_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(48) NOT NULL,
	"type" varchar(24) NOT NULL,
	"language" varchar(2),
	"titleAr" text DEFAULT '' NOT NULL,
	"titleEn" text DEFAULT '' NOT NULL,
	"subtitleAr" text DEFAULT '' NOT NULL,
	"subtitleEn" text DEFAULT '' NOT NULL,
	"orderIndex" integer NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	CONSTRAINT "discover_sections_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "discover_channel_follows" ADD CONSTRAINT "discover_channel_follows_channelId_discover_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."discover_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_channel_follows" ADD CONSTRAINT "discover_channel_follows_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_questions" ADD CONSTRAINT "discover_questions_quizId_discover_quizzes_id_fk" FOREIGN KEY ("quizId") REFERENCES "public"."discover_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discover_quizzes" ADD CONSTRAINT "discover_quizzes_channelId_discover_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."discover_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discover_channel_follows_user_idx" ON "discover_channel_follows" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "discover_channels_language_idx" ON "discover_channels" USING btree ("language","orderIndex");--> statement-breakpoint
CREATE UNIQUE INDEX "discover_questions_quiz_order_idx" ON "discover_questions" USING btree ("quizId","orderIndex");--> statement-breakpoint
CREATE INDEX "discover_quizzes_language_idx" ON "discover_quizzes" USING btree ("language","category");--> statement-breakpoint
CREATE INDEX "discover_quizzes_channel_idx" ON "discover_quizzes" USING btree ("channelId");--> statement-breakpoint
CREATE INDEX "discover_sections_order_idx" ON "discover_sections" USING btree ("orderIndex");