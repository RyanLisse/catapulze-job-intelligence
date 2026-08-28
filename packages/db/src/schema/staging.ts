import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { bron, scrapeRun } from "./curated";
import { stagingSchema } from "./schemas";

export const sourceRecord = stagingSchema.table(
  "source_record",
  {
    bronId: uuid("bron_id")
      .notNull()
      .references(() => bron.id, { onDelete: "cascade" }),
    bronReferentie: text("bron_referentie").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    rawPayloadRef: text("raw_payload_ref").notNull(),
    scrapeRunId: uuid("scrape_run_id")
      .notNull()
      .references(() => scrapeRun.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("source_record_bron_referentie_uidx").on(
      table.bronId,
      table.bronReferentie
    ),
    uniqueIndex("source_record_bron_content_hash_uidx").on(
      table.bronId,
      table.contentHash
    ),
    index("source_record_scrape_run_id_idx").on(table.scrapeRunId),
  ]
);

export const aanvraagObservation = stagingSchema.table(
  "aanvraag_observation",
  {
    bronId: uuid("bron_id")
      .notNull()
      .references(() => bron.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    parserVersion: text("parser_version"),
    payload: jsonb("payload").notNull(),
    scrapeRunId: uuid("scrape_run_id")
      .notNull()
      .references(() => scrapeRun.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecord.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
  },
  (table) => [
    index("aanvraag_observation_source_record_id_idx").on(table.sourceRecordId),
    index("aanvraag_observation_status_idx").on(table.status),
  ]
);

export const sourceRecordRelations = relations(
  sourceRecord,
  ({ one, many }) => ({
    aanvraagObservations: many(aanvraagObservation),
    bron: one(bron, {
      fields: [sourceRecord.bronId],
      references: [bron.id],
    }),
    scrapeRun: one(scrapeRun, {
      fields: [sourceRecord.scrapeRunId],
      references: [scrapeRun.id],
    }),
  })
);

export const aanvraagObservationRelations = relations(
  aanvraagObservation,
  ({ one }) => ({
    bron: one(bron, {
      fields: [aanvraagObservation.bronId],
      references: [bron.id],
    }),
    scrapeRun: one(scrapeRun, {
      fields: [aanvraagObservation.scrapeRunId],
      references: [scrapeRun.id],
    }),
    sourceRecord: one(sourceRecord, {
      fields: [aanvraagObservation.sourceRecordId],
      references: [sourceRecord.id],
    }),
  })
);
