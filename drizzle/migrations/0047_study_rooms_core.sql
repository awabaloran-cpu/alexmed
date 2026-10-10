CREATE TABLE "study_room_bans" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"until" timestamp with time zone,
	"reason" text,
	"byAdminId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "study_room_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"roomId" uuid,
	"actorId" uuid,
	"type" varchar(24) NOT NULL,
	"targetUserId" uuid,
	"data" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_members" (
	"roomId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"role" varchar(8) DEFAULT 'member' NOT NULL,
	"state" varchar(8) DEFAULT 'joined' NOT NULL,
	"grants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mutedByHost" boolean DEFAULT false NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leftAt" timestamp with time zone,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_room_members_roomId_userId_pk" PRIMARY KEY("roomId","userId")
);
--> statement-breakpoint
CREATE TABLE "study_room_profiles" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"gender" varchar(6),
	"genderSetAt" timestamp with time zone,
	"country" varchar(2),
	"birthDate" date,
	"birthDateSetAt" timestamp with time zone,
	"stage" varchar(12),
	"ageFlag" boolean DEFAULT false NOT NULL,
	"rulesAcceptedAt" timestamp with time zone,
	"uiLanguage" varchar(2),
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporterId" uuid,
	"roomId" uuid,
	"targetUserId" uuid,
	"reason" varchar(24) NOT NULL,
	"details" text,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"handledById" uuid,
	"handledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostId" uuid NOT NULL,
	"createdById" uuid,
	"visibility" varchar(8) NOT NULL,
	"audience" varchar(8) NOT NULL,
	"title" text NOT NULL,
	"sectionId" uuid NOT NULL,
	"subjectId" uuid,
	"subjectText" text,
	"topic" text,
	"topicKey" text,
	"university" text,
	"universityKey" text,
	"courseCode" text,
	"language" varchar(8) DEFAULT 'ar' NOT NULL,
	"womenOnly" boolean DEFAULT false NOT NULL,
	"capacity" integer DEFAULT 8 NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bookId" uuid,
	"sharedPage" integer DEFAULT 1 NOT NULL,
	"pageLeaderId" uuid,
	"settings" jsonb NOT NULL,
	"inviteHash" text,
	"locked" boolean DEFAULT false NOT NULL,
	"hiddenAt" timestamp with time zone,
	"status" varchar(8) DEFAULT 'active' NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"lastActiveAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_rooms_inviteHash_unique" UNIQUE("inviteHash")
);
--> statement-breakpoint
CREATE TABLE "study_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(24) NOT NULL,
	"nameAr" text NOT NULL,
	"nameEn" text NOT NULL,
	"icon" varchar(24) NOT NULL,
	"color" varchar(16) NOT NULL,
	"audience" varchar(8) DEFAULT 'adult' NOT NULL,
	"publicRooms" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_sections_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "study_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sectionId" uuid NOT NULL,
	"nameEn" text NOT NULL,
	"nameAr" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_room_bans" ADD CONSTRAINT "study_room_bans_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_events" ADD CONSTRAINT "study_room_events_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_events" ADD CONSTRAINT "study_room_events_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_members" ADD CONSTRAINT "study_room_members_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_members" ADD CONSTRAINT "study_room_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_profiles" ADD CONSTRAINT "study_room_profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_reports" ADD CONSTRAINT "study_room_reports_reporterId_users_id_fk" FOREIGN KEY ("reporterId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_reports" ADD CONSTRAINT "study_room_reports_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_reports" ADD CONSTRAINT "study_room_reports_targetUserId_users_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_hostId_users_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_sectionId_study_sections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."study_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_subjectId_study_subjects_id_fk" FOREIGN KEY ("subjectId") REFERENCES "public"."study_subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_rooms" ADD CONSTRAINT "study_rooms_bookId_books_id_fk" FOREIGN KEY ("bookId") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_subjects" ADD CONSTRAINT "study_subjects_sectionId_study_sections_id_fk" FOREIGN KEY ("sectionId") REFERENCES "public"."study_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_room_events_room_idx" ON "study_room_events" USING btree ("roomId","createdAt");--> statement-breakpoint
CREATE INDEX "study_room_events_actor_idx" ON "study_room_events" USING btree ("actorId","type","createdAt");--> statement-breakpoint
CREATE INDEX "study_room_members_user_idx" ON "study_room_members" USING btree ("userId","state");--> statement-breakpoint
CREATE INDEX "study_room_reports_status_idx" ON "study_room_reports" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "study_room_reports_room_idx" ON "study_room_reports" USING btree ("roomId");--> statement-breakpoint
CREATE INDEX "study_rooms_explore_idx" ON "study_rooms" USING btree ("status","visibility","sectionId","lastActiveAt");--> statement-breakpoint
CREATE INDEX "study_rooms_subject_idx" ON "study_rooms" USING btree ("subjectId","topicKey");--> statement-breakpoint
CREATE INDEX "study_rooms_host_idx" ON "study_rooms" USING btree ("hostId","status");--> statement-breakpoint
CREATE INDEX "study_rooms_book_idx" ON "study_rooms" USING btree ("bookId");--> statement-breakpoint
CREATE INDEX "study_subjects_section_idx" ON "study_subjects" USING btree ("sectionId");--> statement-breakpoint
CREATE UNIQUE INDEX "study_subjects_section_name_idx" ON "study_subjects" USING btree ("sectionId","nameEn");--> statement-breakpoint
INSERT INTO "study_sections" ("key", "nameAr", "nameEn", "icon", "color", "audience", "publicRooms", "sortOrder") VALUES
	('medicine', 'طب', 'Medicine', 'stethoscope', 'med', 'adult', true, 10),
	('pharmacy', 'صيدلة', 'Pharmacy', 'pill', 'pharm', 'adult', true, 20),
	('engineering', 'هندسة', 'Engineering', 'ruler', 'eng', 'adult', true, 30),
	('science', 'علوم', 'Science', 'flask-conical', 'sci', 'adult', true, 40),
	('programming', 'برمجة', 'Programming', 'code', 'code', 'adult', true, 50),
	('high_school', 'ثانوية عامة', 'High school', 'graduation-cap', 'hs', 'minor', false, 60);--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('Anatomy', 'التشريح', '["anatomy","التشريح","اناتومي","تشريح"]'),
	('Physiology', 'الفسيولوجي', '["physiology","الفسيولوجي","فسيو","فسيولوجيا","علم وظائف الاعضاء","physio"]'),
	('Biochemistry', 'الكيمياء الحيوية', '["biochemistry","الكيمياء الحيويه","بايو","بيوكيمستري","biochem"]'),
	('Histology', 'الهستولوجي', '["histology","الهستولوجي","هستو","علم الانسجه","histo"]'),
	('Pathology', 'الباثولوجي', '["pathology","الباثولوجي","باثو","علم الامراض","patho"]'),
	('Pharmacology', 'علم الأدوية', '["pharmacology","علم الادويه","فارما","فارماكولوجي","pharma"]'),
	('Microbiology', 'الميكروبيولوجي', '["microbiology","الميكروبيولوجي","ميكرو","الاحياء الدقيقه","micro"]'),
	('Parasitology', 'الطفيليات', '["parasitology","الطفيليات","باراسيتولوجي","para"]'),
	('Immunology', 'المناعة', '["immunology","المناعه","immuno"]'),
	('Community Medicine', 'طب المجتمع', '["community medicine","طب المجتمع","كوميونتي","public health","الصحه العامه"]'),
	('Forensic Medicine', 'الطب الشرعي', '["forensic medicine","الطب الشرعي","فورنسك","forensic","toxicology","السموم"]'),
	('Internal Medicine', 'الباطنة', '["internal medicine","الباطنه","باطنه","medicine","internal"]'),
	('Surgery', 'الجراحة', '["surgery","الجراحه","جراحه","general surgery"]'),
	('Pediatrics', 'الأطفال', '["pediatrics","الاطفال","اطفال","pedia","paediatrics"]'),
	('Obstetrics and Gynecology', 'النساء والتوليد', '["obstetrics and gynecology","النساء والتوليد","نسا","نساء","obgyn","ob gyn","gyne"]'),
	('Ophthalmology', 'الرمد', '["ophthalmology","الرمد","عيون","ophtha"]'),
	('ENT', 'الأنف والأذن والحنجرة', '["ent","الانف والاذن والحنجره","انف واذن","otolaryngology"]'),
	('Family Medicine', 'طب الأسرة', '["family medicine","طب الاسره","family"]'),
	('Psychiatry', 'الطب النفسي', '["psychiatry","الطب النفسي","نفسيه","psych"]'),
	('Dermatology', 'الجلدية', '["dermatology","الجلديه","جلديه","derma"]'),
	('Radiology', 'الأشعة', '["radiology","الاشعه","اشعه","radio"]'),
	('Neurology', 'الأعصاب', '["neurology","الاعصاب","مخ واعصاب","neuro"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'medicine';--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('Pharmaceutics', 'الصيدلانيات', '["pharmaceutics","الصيدلانيات","صيدلانيات"]'),
	('Pharmacognosy', 'العقاقير', '["pharmacognosy","العقاقير","عقاقير","cognosy"]'),
	('Pharmaceutical Chemistry', 'الكيمياء الصيدلية', '["pharmaceutical chemistry","الكيمياء الصيدليه","medicinal chemistry","كيميا صيدليه"]'),
	('Organic Chemistry', 'الكيمياء العضوية', '["organic chemistry","الكيمياء العضويه","عضويه","organic"]'),
	('Pharmacology', 'علم الأدوية', '["pharmacology","علم الادويه","فارما","pharma"]'),
	('Clinical Pharmacy', 'الصيدلة الإكلينيكية', '["clinical pharmacy","الصيدله الاكلينيكيه","كلينيكال","clinical"]'),
	('Analytical Chemistry', 'الكيمياء التحليلية', '["analytical chemistry","الكيمياء التحليليه","تحليليه","analytical"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'pharmacy';--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('Calculus', 'التفاضل والتكامل', '["calculus","التفاضل والتكامل","كالكولس","تفاضل","تكامل","math"]'),
	('Linear Algebra', 'الجبر الخطي', '["linear algebra","الجبر الخطي","جبر","algebra"]'),
	('Physics', 'الفيزياء', '["physics","الفيزياء","فيزيا"]'),
	('Statics', 'الاستاتيكا', '["statics","الاستاتيكا","ستاتيكا","mechanics"]'),
	('Dynamics', 'الديناميكا', '["dynamics","الديناميكا","ديناميكا"]'),
	('Electric Circuits', 'الدوائر الكهربية', '["electric circuits","الدوائر الكهربيه","دواير","circuits"]'),
	('Thermodynamics', 'الديناميكا الحرارية', '["thermodynamics","الديناميكا الحراريه","ثرمو","thermo"]'),
	('Engineering Drawing', 'الرسم الهندسي', '["engineering drawing","الرسم الهندسي","رسم"]'),
	('Strength of Materials', 'مقاومة المواد', '["strength of materials","مقاومه المواد","مقاومه"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'engineering';--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('General Chemistry', 'الكيمياء العامة', '["general chemistry","الكيمياء العامه","كيميا","chemistry"]'),
	('General Physics', 'الفيزياء العامة', '["general physics","الفيزياء العامه","فيزيا","physics"]'),
	('Biology', 'الأحياء', '["biology","الاحياء","احيا","bio"]'),
	('Mathematics', 'الرياضيات', '["mathematics","الرياضيات","رياضه","math","maths"]'),
	('Statistics', 'الإحصاء', '["statistics","الاحصاء","احصا","stats"]'),
	('Geology', 'الجيولوجيا', '["geology","الجيولوجيا","جيولوجيا"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'science';--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('Programming Fundamentals', 'أساسيات البرمجة', '["programming fundamentals","اساسيات البرمجه","برمجه","intro to programming","cs1"]'),
	('Data Structures', 'هياكل البيانات', '["data structures","هياكل البيانات","داتا ستراكتشر","ds"]'),
	('Algorithms', 'الخوارزميات', '["algorithms","الخوارزميات","الجوريزم","algo"]'),
	('Databases', 'قواعد البيانات', '["databases","قواعد البيانات","داتابيز","sql","db"]'),
	('Operating Systems', 'نظم التشغيل', '["operating systems","نظم التشغيل","os"]'),
	('Computer Networks', 'شبكات الحاسب', '["computer networks","شبكات الحاسب","نتورك","networks"]'),
	('Web Development', 'تطوير الويب', '["web development","تطوير الويب","ويب","web"]'),
	('Object-Oriented Programming', 'البرمجة الكائنية', '["object oriented programming","البرمجه الكائنيه","oop"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'programming';--> statement-breakpoint
INSERT INTO "study_subjects" ("sectionId", "nameEn", "nameAr", "aliases")
SELECT s."id", v."nameEn", v."nameAr", v."aliases"::jsonb FROM "study_sections" s, (VALUES
	('Physics', 'الفيزياء', '["physics","الفيزياء","فيزيا"]'),
	('Chemistry', 'الكيمياء', '["chemistry","الكيمياء","كيميا"]'),
	('Biology', 'الأحياء', '["biology","الاحياء","احيا"]'),
	('Mathematics', 'الرياضيات', '["mathematics","الرياضيات","رياضه","math"]'),
	('Arabic', 'اللغة العربية', '["arabic","اللغه العربيه","عربي","نحو"]'),
	('English', 'اللغة الإنجليزية', '["english","اللغه الانجليزيه","انجليزي","انقلش"]'),
	('Geology', 'الجيولوجيا', '["geology","الجيولوجيا","جيولوجيا"]'),
	('History', 'التاريخ', '["history","التاريخ","تاريخ"]'),
	('Geography', 'الجغرافيا', '["geography","الجغرافيا","جغرافيا"]')
) AS v("nameEn", "nameAr", "aliases") WHERE s."key" = 'high_school';
