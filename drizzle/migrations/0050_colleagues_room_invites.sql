CREATE TABLE "study_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requesterId" uuid NOT NULL,
	"addresseeId" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"respondedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_room_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roomId" uuid NOT NULL,
	"inviterId" uuid NOT NULL,
	"inviteeId" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"respondedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_connections" ADD CONSTRAINT "study_connections_requesterId_users_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_connections" ADD CONSTRAINT "study_connections_addresseeId_users_id_fk" FOREIGN KEY ("addresseeId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_invites" ADD CONSTRAINT "study_room_invites_roomId_study_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."study_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_invites" ADD CONSTRAINT "study_room_invites_inviterId_users_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_room_invites" ADD CONSTRAINT "study_room_invites_inviteeId_users_id_fk" FOREIGN KEY ("inviteeId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_connections_live_pair_idx" ON "study_connections" USING btree (least("requesterId", "addresseeId"),greatest("requesterId", "addresseeId")) WHERE "study_connections"."status" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "study_connections_requester_idx" ON "study_connections" USING btree ("requesterId","status");--> statement-breakpoint
CREATE INDEX "study_connections_addressee_idx" ON "study_connections" USING btree ("addresseeId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "study_room_invites_live_idx" ON "study_room_invites" USING btree ("roomId","inviteeId") WHERE "study_room_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "study_room_invites_invitee_idx" ON "study_room_invites" USING btree ("inviteeId","status");--> statement-breakpoint
CREATE INDEX "study_room_invites_inviter_idx" ON "study_room_invites" USING btree ("inviterId","createdAt");