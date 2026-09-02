CREATE TABLE "curated"."aanvraag_markering" (
	"aanvraag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reden" text,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curated"."aanvraag_markering" ADD CONSTRAINT "aanvraag_markering_aanvraag_id_aanvraag_id_fk" FOREIGN KEY ("aanvraag_id") REFERENCES "curated"."aanvraag"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "aanvraag_markering_user_aanvraag_uidx" ON "curated"."aanvraag_markering" USING btree ("user_id","aanvraag_id");
--> statement-breakpoint
CREATE INDEX "aanvraag_markering_aanvraag_id_idx" ON "curated"."aanvraag_markering" USING btree ("aanvraag_id");
--> statement-breakpoint
CREATE INDEX "aanvraag_markering_user_id_idx" ON "curated"."aanvraag_markering" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "audit_event_actor_id_idx" ON "curated"."audit_event" USING btree ("actor_id");
--> statement-breakpoint
ALTER TABLE "curated"."aanvraag_markering" ADD CONSTRAINT "aanvraag_markering_status_check" CHECK ("status" IN ('relevant', 'niet_relevant', 'gevolgd'));
