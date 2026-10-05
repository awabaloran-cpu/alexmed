CREATE TYPE "public_exam_status" AS ENUM ('draft', 'published', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public_exam_session_status" AS ENUM ('active', 'submitted', 'abandoned', 'expired');--> statement-breakpoint
CREATE TABLE "public_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bookId" uuid NOT NULL,
	"createdById" uuid,
	"slug" varchar(160) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "public_exam_status" DEFAULT 'draft' NOT NULL,
	"freeQuestionsBeforeLogin" integer DEFAULT 40 NOT NULL,
	"questionLimit" integer,
	"shuffleQuestions" boolean DEFAULT true NOT NULL,
	"shuffleOptions" boolean DEFAULT false NOT NULL,
	"durationSeconds" integer,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"publishedAt" timestamp with time zone,
	"pausedAt" timestamp with time zone,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_exams_window_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
	CONSTRAINT "public_exams_free_questions_check" CHECK ("freeQuestionsBeforeLogin" >= 1)
);
--> statement-breakpoint
CREATE TABLE "public_exam_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"examId" uuid NOT NULL,
	"userId" uuid,
	"anonymousId" varchar(120) NOT NULL,
	"status" "public_exam_session_status" DEFAULT 'active' NOT NULL,
	"source" varchar(80),
	"utmSource" varchar(120),
	"utmMedium" varchar(120),
	"utmCampaign" varchar(160),
	"utmContent" varchar(160),
	"utmTerm" varchar(160),
	"telegramPayload" jsonb,
	"questionOrder" jsonb NOT NULL,
	"optionOrderByQuestion" jsonb,
	"currentQuestionIndex" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone,
	"submittedAt" timestamp with time zone,
	"score" integer,
	"result" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_exam_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"questionId" uuid NOT NULL,
	"questionIndex" integer NOT NULL,
	"selectedIndex" integer NOT NULL,
	"correctIndex" integer,
	"isCorrect" boolean NOT NULL,
	"answeredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_exam_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"examId" uuid,
	"sessionId" uuid,
	"actorId" uuid,
	"anonymousId" varchar(120),
	"event" varchar(48) NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_exams" ADD CONSTRAINT "public_exams_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exams" ADD CONSTRAINT "public_exams_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_sessions" ADD CONSTRAINT "public_exam_sessions_examId_public_exams_id_fk" FOREIGN KEY ("examId") REFERENCES "public"."public_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_sessions" ADD CONSTRAINT "public_exam_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_answers" ADD CONSTRAINT "public_exam_answers_sessionId_public_exam_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."public_exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_answers" ADD CONSTRAINT "public_exam_answers_questionId_extracted_questions_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."extracted_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_events" ADD CONSTRAINT "public_exam_events_examId_public_exams_id_fk" FOREIGN KEY ("examId") REFERENCES "public"."public_exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_events" ADD CONSTRAINT "public_exam_events_sessionId_public_exam_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."public_exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_exam_events" ADD CONSTRAINT "public_exam_events_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_exams_slug_idx" ON "public_exams" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "public_exams_status_created_at_idx" ON "public_exams" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "public_exams_book_id_idx" ON "public_exams" USING btree ("bookId");--> statement-breakpoint
CREATE INDEX "public_exam_sessions_exam_status_idx" ON "public_exam_sessions" USING btree ("examId","status");--> statement-breakpoint
CREATE INDEX "public_exam_sessions_user_exam_idx" ON "public_exam_sessions" USING btree ("userId","examId");--> statement-breakpoint
CREATE INDEX "public_exam_sessions_anon_exam_idx" ON "public_exam_sessions" USING btree ("anonymousId","examId");--> statement-breakpoint
CREATE UNIQUE INDEX "public_exam_answers_session_question_idx" ON "public_exam_answers" USING btree ("sessionId","questionId");--> statement-breakpoint
CREATE INDEX "public_exam_answers_session_index_idx" ON "public_exam_answers" USING btree ("sessionId","questionIndex");--> statement-breakpoint
CREATE INDEX "public_exam_events_exam_created_idx" ON "public_exam_events" USING btree ("examId","createdAt");--> statement-breakpoint
CREATE INDEX "public_exam_events_session_created_idx" ON "public_exam_events" USING btree ("sessionId","createdAt");
