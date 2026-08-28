import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { curatedSchema } from "./schemas";

export const bron = curatedSchema.table(
  "bron",
  {
    actief: boolean("actief").default(false).notNull(),
    categorie: text("categorie").notNull(),
    configRef: text("config_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    ingestieType: text("ingestie_type"),
    loginVereist: boolean("login_vereist").default(false).notNull(),
    naam: text("naam").notNull(),
    schedule: text("schedule"),
    secretRef: text("secret_ref"),
    status: text("status").default("deferred").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    voorwaardenStatus: text("voorwaarden_status")
      .default("te_toetsen")
      .notNull(),
    website: text("website"),
  },
  (table) => [
    index("bron_status_idx").on(table.status),
    index("bron_categorie_idx").on(table.categorie),
  ]
);

export const scrapeRun = curatedSchema.table(
  "scrape_run",
  {
    aantalGevonden: integer("aantal_gevonden").default(0).notNull(),
    bronId: uuid("bron_id")
      .notNull()
      .references(() => bron.id, { onDelete: "cascade" }),
    circuitStatus: text("circuit_status").default("closed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    fouten: integer("fouten").default(0).notNull(),
    geindigd: timestamp("geindigd", { withTimezone: true }),
    gesloten: integer("gesloten").default(0).notNull(),
    gestart: timestamp("gestart", { withTimezone: true })
      .defaultNow()
      .notNull(),
    gewijzigd: integer("gewijzigd").default(0).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    nieuw: integer("nieuw").default(0).notNull(),
    status: text("status").default("running").notNull(),
    versieAdapter: text("versie_adapter"),
  },
  (table) => [
    index("scrape_run_bron_id_idx").on(table.bronId),
    index("scrape_run_gestart_idx").on(table.gestart),
  ]
);

export const dedupGroep = curatedSchema.table(
  "dedup_groep",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    handmatigBevestigd: boolean("handmatig_bevestigd").default(false).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    methode: text("methode"),
    primaireAanvraagId: uuid("primaire_aanvraag_id"),
    similariteit: numeric("similariteit"),
    status: text("status").default("reviewable").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("dedup_groep_status_idx").on(table.status)]
);

export const aanvraag = curatedSchema.table(
  "aanvraag",
  {
    beschrijving: text("beschrijving").notNull(),
    bronId: uuid("bron_id")
      .notNull()
      .references(() => bron.id, { onDelete: "restrict" }),
    bronReferentie: text("bron_referentie").notNull(),
    bronSpecifiek: jsonb("bron_specifiek").default({}).notNull(),
    bronUrl: text("bron_url"),
    compleetheidScore: numeric("compleetheid_score"),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    dedupGroepId: uuid("dedup_groep_id").references(() => dedupGroep.id, {
      onDelete: "set null",
    }),
    eersteGezienOp: timestamp("eerste_gezien_op", {
      withTimezone: true,
    }).notNull(),
    extractieMethode: text("extractie_methode").notNull(),
    functiegroep: text("functiegroep").default("overig").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    laatstGezienOp: timestamp("laatst_gezien_op", {
      withTimezone: true,
    }).notNull(),
    locatieLand: text("locatie_land").default("NL").notNull(),
    rawPayloadRef: text("raw_payload_ref").notNull(),
    scrapeRunId: uuid("scrape_run_id")
      .notNull()
      .references(() => scrapeRun.id, { onDelete: "restrict" }),
    status: text("status").default("unknown").notNull(),
    taal: text("taal").default("nl").notNull(),
    tariefEenheid: text("tarief_eenheid"),
    tariefMax: numeric("tarief_max"),
    tariefMin: numeric("tarief_min"),
    tariefValuta: text("tarief_valuta").default("EUR").notNull(),
    titel: text("titel").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    versie: integer("versie").default(1).notNull(),
  },
  (table) => [
    uniqueIndex("aanvraag_bron_referentie_uidx").on(
      table.bronId,
      table.bronReferentie
    ),
    index("aanvraag_dedup_groep_id_idx").on(table.dedupGroepId),
    index("aanvraag_status_idx").on(table.status),
  ]
);

export const aanvraagVersie = curatedSchema.table(
  "aanvraag_versie",
  {
    aanvraagId: uuid("aanvraag_id")
      .notNull()
      .references(() => aanvraag.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    geldigTot: timestamp("geldig_tot", { withTimezone: true }),
    geldigVan: timestamp("geldig_van", { withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    rawPayloadRef: text("raw_payload_ref").notNull(),
    scrapeRunId: uuid("scrape_run_id")
      .notNull()
      .references(() => scrapeRun.id, { onDelete: "restrict" }),
    snapshot: jsonb("snapshot").notNull(),
    versie: integer("versie").notNull(),
  },
  (table) => [
    uniqueIndex("aanvraag_versie_aanvraag_versie_uidx").on(
      table.aanvraagId,
      table.versie
    ),
    index("aanvraag_versie_open_idx")
      .on(table.aanvraagId)
      .where(sql`${table.geldigTot} IS NULL`),
  ]
);

export const aanvraagBronLink = curatedSchema.table(
  "aanvraag_bron_link",
  {
    aanvraagId: uuid("aanvraag_id")
      .notNull()
      .references(() => aanvraag.id, { onDelete: "cascade" }),
    bronId: uuid("bron_id")
      .notNull()
      .references(() => bron.id, { onDelete: "cascade" }),
    bronReferentie: text("bron_referentie").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    isPrimary: boolean("is_primary").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("aanvraag_bron_link_aanvraag_bron_uidx").on(
      table.aanvraagId,
      table.bronId
    ),
  ]
);

export const savedSearch = curatedSchema.table(
  "saved_search",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    filters: jsonb("filters").default({}).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    naam: text("naam").notNull(),
    parserVersion: text("parser_version").notNull(),
    queryText: text("query_text").notNull(),
    schemaVersion: text("schema_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [index("saved_search_user_id_idx").on(table.userId)]
);

export const querySnapshot = curatedSchema.table(
  "query_snapshot",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    filters: jsonb("filters").default({}).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    indexVersion: integer("index_version"),
    parserVersion: text("parser_version").notNull(),
    queryText: text("query_text").notNull(),
    resultIds: jsonb("result_ids").default([]).notNull(),
    savedSearchId: uuid("saved_search_id").references(() => savedSearch.id, {
      onDelete: "set null",
    }),
    schemaVersion: text("schema_version").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [index("query_snapshot_user_id_idx").on(table.userId)]
);

export const auditEvent = curatedSchema.table(
  "audit_event",
  {
    action: text("action").notNull(),
    actorId: text("actor_id"),
    actorType: text("actor_type").default("system").notNull(),
    auditClass: text("audit_class"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    entityId: text("entity_id").notNull(),
    entityType: text("entity_type").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    metadata: jsonb("metadata").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_event_entity_idx").on(table.entityType, table.entityId),
    index("audit_event_occurred_at_idx").on(table.occurredAt),
  ]
);

export const outboxEvent = curatedSchema.table(
  "outbox_event",
  {
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    eventType: text("event_type").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    indexVersion: integer("index_version"),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_event_unprocessed_idx")
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
  ]
);

export const agentContext = curatedSchema.table(
  "agent_context",
  {
    context: jsonb("context").default({}).notNull(),
    entityId: text("entity_id").notNull(),
    entityType: text("entity_type").notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_context_entity_uidx").on(
      table.entityType,
      table.entityId
    ),
  ]
);

export const bronRelations = relations(bron, ({ many }) => ({
  aanvragen: many(aanvraag),
  scrapeRuns: many(scrapeRun),
}));

export const scrapeRunRelations = relations(scrapeRun, ({ one, many }) => ({
  aanvragen: many(aanvraag),
  bron: one(bron, {
    fields: [scrapeRun.bronId],
    references: [bron.id],
  }),
  versies: many(aanvraagVersie),
}));

export const dedupGroepRelations = relations(dedupGroep, ({ many }) => ({
  aanvragen: many(aanvraag),
}));

export const aanvraagRelations = relations(aanvraag, ({ one, many }) => ({
  bron: one(bron, {
    fields: [aanvraag.bronId],
    references: [bron.id],
  }),
  bronLinks: many(aanvraagBronLink),
  dedupGroep: one(dedupGroep, {
    fields: [aanvraag.dedupGroepId],
    references: [dedupGroep.id],
  }),
  scrapeRun: one(scrapeRun, {
    fields: [aanvraag.scrapeRunId],
    references: [scrapeRun.id],
  }),
  versies: many(aanvraagVersie),
}));

export const aanvraagVersieRelations = relations(aanvraagVersie, ({ one }) => ({
  aanvraag: one(aanvraag, {
    fields: [aanvraagVersie.aanvraagId],
    references: [aanvraag.id],
  }),
  scrapeRun: one(scrapeRun, {
    fields: [aanvraagVersie.scrapeRunId],
    references: [scrapeRun.id],
  }),
}));

export const aanvraagBronLinkRelations = relations(
  aanvraagBronLink,
  ({ one }) => ({
    aanvraag: one(aanvraag, {
      fields: [aanvraagBronLink.aanvraagId],
      references: [aanvraag.id],
    }),
    bron: one(bron, {
      fields: [aanvraagBronLink.bronId],
      references: [bron.id],
    }),
  })
);

export const savedSearchRelations = relations(savedSearch, ({ many }) => ({
  snapshots: many(querySnapshot),
}));

export const querySnapshotRelations = relations(querySnapshot, ({ one }) => ({
  savedSearch: one(savedSearch, {
    fields: [querySnapshot.savedSearchId],
    references: [savedSearch.id],
  }),
}));
