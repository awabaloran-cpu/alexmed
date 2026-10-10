CREATE TABLE "study_room_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roomId" uuid NOT NULL,
	"userId" uuid,
	"bookId" uuid NOT NULL,
	"pageNumber" integer NOT NULL,
	"color" varchar(8) NOT NULL,
	"rects" jsonb NOT NULL,
	"text" text,
	"clientId" varchar(40) NOT NULL,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roomId" uuid NOT NULL,
	"userId" uuid,
	"body" text NOT NULL,
	"page" integer,
	"clientId" varchar(40) NOT NULL,
	"seq" bigint NOT NULL,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_quiz_answers" (
	"quizId" uuid NOT NULL,
	"questionId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"selectedIndex" integer NOT NULL,
	"isCorrect" boolean,
	"answerMs" integer NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_room_quiz_answers_quizId_questionId_userId_pk" PRIMARY KEY("quizId","questionId","userId")
);
--> statement-breakpoint
CREATE TABLE "study_room_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roomId" uuid NOT NULL,
	"bookId" uuid,
	"startedById" uuid,
	"questionIds" jsonb NOT NULL,
	"secondsPerQuestion" integer NOT NULL,
	"state" varchar(10) DEFAULT 'question' NOT NULL,
	"currentIndex" integer DEFAULT 0 NOT NULL,
	"questionStartedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "study_room_marks" ADD CONSTRAINT "study_room_marks_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_marks" ADD CONSTRAINT "study_room_marks_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_marks" ADD CONSTRAINT "study_room_marks_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_messages" ADD CONSTRAINT "study_room_messages_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_messages" ADD CONSTRAINT "study_room_messages_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_quiz_answers" ADD CONSTRAINT "study_room_quiz_answers_quizId_study_room_quizzes_id_fk" FOREIGN KEY ("quizId") REFERENCES "public"."study_room_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_quiz_answers" ADD CONSTRAINT "study_room_quiz_answers_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_quizzes" ADD CONSTRAINT "study_room_quizzes_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_quizzes" ADD CONSTRAINT "study_room_quizzes_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_quizzes" ADD CONSTRAINT "study_room_quizzes_startedById_users_id_fk" FOREIGN KEY ("startedById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_room_marks_room_page_idx" ON "study_room_marks" USING btree ("roomId","pageNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "study_room_marks_client_idx" ON "study_room_marks" USING btree ("roomId","userId","clientId");--> statement-breakpoint
CREATE INDEX "study_room_messages_room_seq_idx" ON "study_room_messages" USING btree ("roomId","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "study_room_messages_client_idx" ON "study_room_messages" USING btree ("roomId","userId","clientId");--> statement-breakpoint
CREATE INDEX "study_room_quizzes_room_idx" ON "study_room_quizzes" USING btree ("roomId","state");--> statement-breakpoint
CREATE UNIQUE INDEX "study_room_quizzes_running_idx" ON "study_room_quizzes" USING btree ("roomId") WHERE "study_room_quizzes"."state" in ('question', 'reveal');