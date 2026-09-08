import type {
  AanvraagLifecycle,
  AanvraagId,
  BronId,
  ScrapeRunId,
} from "@ji/domain";
import { CLEARED, UNKNOWN } from "@ji/domain";
import { timeCriticalPathPhase } from "@ji/performance";
import { z } from "zod";

import type { NormalisedAanvraagDraft } from "../normalise";
import { buildDedupKey, buildProvenanceMap } from "../normalise";
import { classifyContractAndWork } from "../normalise/classify-contract-work";
import type {
  AanvraagSnapshot,
  BronSpecifiekJson,
  OutboxPayload,
  ProvenanceMap,
} from "./json-types";

export type ObservationProcessingStatus =
  | "curated"
  | "quarantined"
  | "unchanged";

export interface StoredAanvraag {
  aanvraagId: AanvraagId;
  beschrijving: string;
  bronId: BronId;
  bronReferentie: string;
  bronSpecifiek: BronSpecifiekJson;
  bronUrl: string | null;
  contentHash: string;
  contracttype: string | null;
  dedupGroepId: string | null;
  extractieMethode: string;
  eersteGezienOp: Date;
  eindDatum: string | null;
  laatstGezienOp: Date;
  locatieLand: string;
  locatieTekst: string | null;
  opdrachtgeverNaam: string | null;
  parserVersion: string;
  provenance: ProvenanceMap;
  publicatiedatum: string | null;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
  sluitingsdatum: Date | null;
  startDatum: string | null;
  status: AanvraagLifecycle;
  tariefEenheid: string | null;
  tariefMax: string | null;
  tariefMin: string | null;
  tariefValuta: string;
  titel: string;
  urenPerWeek: string | null;
  versie: number;
  werkvorm: string | null;
}

export interface StoredAanvraagVersie {
  aanvraagId: AanvraagId;
  contentHash: string;
  geldigTot: Date | null;
  geldigVan: Date;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
  snapshot: AanvraagSnapshot;
  versie: number;
  versieId: string;
}

export interface StoredDedupGroep {
  dedupGroepId: string;
  dedupKey: string;
  handmatigBevestigd: boolean;
  status: "reviewable";
}

export interface StoredOutboxEvent {
  aggregateId: AanvraagId;
  aggregateType: "aanvraag";
  eventType: string;
  id: string;
  payload: OutboxPayload;
}

export interface CurateStore {
  findAanvraagByIdentity: (
    bronId: BronId,
    bronReferentie: string
  ) => Promise<StoredAanvraag | null>;
  /**
   * Returns the one group for `dedupKey`, creating it when absent. Must be
   * safe under concurrency: two callers racing on the same key — in
   * separate transactions — both get the same group. The Postgres store
   * leans on the unique index `dedup_groep_dedup_key_uidx` for this
   * (insert ... on conflict do nothing, then re-select); a find-then-insert
   * under READ COMMITTED is not enough.
   */
  ensureDedupGroep: (input: { dedupKey: string }) => Promise<StoredDedupGroep>;
  findDedupGroepByKey: (dedupKey: string) => Promise<StoredDedupGroep | null>;
  insertAanvraag: (
    input: Omit<StoredAanvraag, "aanvraagId">
  ) => Promise<StoredAanvraag>;
  insertOutboxEvent: (
    input: Omit<StoredOutboxEvent, "id">
  ) => Promise<StoredOutboxEvent>;
  insertVersie: (
    input: Omit<StoredAanvraagVersie, "versieId">
  ) => Promise<StoredAanvraagVersie>;
  linkAanvraagToDedupGroep: (
    aanvraagId: AanvraagId,
    dedupGroepId: string
  ) => Promise<void>;
  splitDedupGroep: (dedupGroepId: string) => Promise<void>;
  updateAanvraag: (
    aanvraagId: AanvraagId,
    patch: Partial<StoredAanvraag>
  ) => Promise<StoredAanvraag>;
  closeOpenVersie: (aanvraagId: AanvraagId, closedAt: Date) => Promise<void>;
  /**
   * Runs `fn` against a store whose writes commit together or not at all
   * (RJC-399). A throw inside `fn` rolls every write back, so the SCD2
   * status write and its outbox event can never be split by a crash —
   * without the event the projector would keep the old status forever,
   * because a later same-content event is skipped by the projection hash.
   */
  withTransaction: <T>(fn: (store: CurateStore) => Promise<T>) => Promise<T>;
}

export interface CurateObservationInput {
  bronId: BronId;
  draft: NormalisedAanvraagDraft;
  observedAt: Date;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
}

export interface CurateObservationResult {
  aanvraagId?: AanvraagId;
  dedupGroepId?: string;
  outboxEventId?: string;
  reason?: string;
  status: ObservationProcessingStatus;
  versie?: number;
}

const tariefColumn = (
  value: string | typeof UNKNOWN | typeof CLEARED
): string | null => (value === UNKNOWN || value === CLEARED ? null : value);

const bronSpecifiekRecordSchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ])
);

type BronSpecifiekRecord = z.infer<typeof bronSpecifiekRecordSchema>;

const asBronSpecifiekRecord = (
  value: BronSpecifiekJson
): BronSpecifiekRecord => {
  const parsed = bronSpecifiekRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

const readExistingText = (
  record: BronSpecifiekRecord,
  ...keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = record[key];
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Zod record values are a union; string is the only commercial text shape we copy
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
};

/**
 * Persist commercial facts that the draft already computed but that have no
 * curated column yet: merge into bron_specifiek under the keys the reader
 * already understands, and fill contracttype/werkvorm via the shared
 * classifier when the normaliser left them blank.
 */
const commercialBronSpecifiek = (
  draft: NormalisedAanvraagDraft
): BronSpecifiekJson => {
  const base: BronSpecifiekRecord = {
    ...asBronSpecifiekRecord(draft.bronSpecifiek.value),
  };
  if (draft.opdrachtgeverNaam.value === CLEARED) {
    // Tombstone every reader alias so merge drops prior camel/snake keys.
    base.opdrachtgever_naam = CLEARED;
    base.opdrachtgeverNaam = CLEARED;
  } else if (
    draft.opdrachtgeverNaam.value !== UNKNOWN &&
    readExistingText(base, "opdrachtgever_naam", "opdrachtgeverNaam") === null
  ) {
    base.opdrachtgever_naam = draft.opdrachtgeverNaam.value;
  }
  if (draft.startDatum.value === CLEARED) {
    base.start_datum = CLEARED;
    base.startDatum = CLEARED;
  } else if (
    draft.startDatum.value !== UNKNOWN &&
    readExistingText(base, "start_datum", "startDatum") === null
  ) {
    base.start_datum = draft.startDatum.value;
  }
  const classified = classifyContractAndWork(
    draft.titel.value,
    draft.beschrijving.value
  );
  if (
    classified.contracttype &&
    readExistingText(base, "contracttype", "contract_type") === null
  ) {
    base.contracttype = classified.contracttype;
  }
  if (classified.werkvorm && readExistingText(base, "werkvorm") === null) {
    base.werkvorm = classified.werkvorm;
  }
  // SAFETY: BronSpecifiekRecord is a string-keyed JSON object produced by Zod;
  // BronSpecifiekJson is the same JsonValue object shape at the curate boundary.
  return base as BronSpecifiekJson;
};

type CoalescePatch<T> =
  | { tag: "absent" }
  | { tag: "clear" }
  | { tag: "set"; value: T };

const coalescePatchFromDraft = (
  value: string | typeof UNKNOWN | typeof CLEARED
): CoalescePatch<string> => {
  if (value === CLEARED) {
    return { tag: "clear" };
  }
  if (value === UNKNOWN) {
    return { tag: "absent" };
  }
  return { tag: "set", value };
};

const applyCoalesce = <T>(
  patch: CoalescePatch<T>,
  existing: T | null
): T | null => {
  switch (patch.tag) {
    case "absent": {
      return existing;
    }
    case "clear": {
      return null;
    }
    case "set": {
      return patch.value;
    }
    default: {
      const _exhaustive: never = patch;
      return _exhaustive;
    }
  }
};

/** Sparse null keeps the prior value; use CLEARED at the draft boundary for a true clear. */
const coalesceNullable = <T>(
  incoming: T | null,
  existing: T | null
): T | null => incoming ?? existing;

const draftTextColumn = (
  value: string | typeof UNKNOWN | typeof CLEARED
): string | null => (value === UNKNOWN || value === CLEARED ? null : value);

const readBronText = (
  record: BronSpecifiekRecord,
  ...keys: readonly string[]
): string | null => {
  const value = readExistingText(record, ...keys);
  if (value === null || value === CLEARED || value === UNKNOWN) {
    return null;
  }
  return value;
};

const explicitBronText = (
  draft: NormalisedAanvraagDraft,
  ...keys: readonly string[]
): string | null =>
  readBronText(asBronSpecifiekRecord(draft.bronSpecifiek.value), ...keys);

/** Drop CLEARED tombstones so they never persist inside bron_specifiek JSON. */
const stripClearedBronSpecifiek = (
  record: BronSpecifiekRecord
): BronSpecifiekRecord => {
  const out: BronSpecifiekRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== CLEARED) {
      out[key] = value;
    }
  }
  return out;
};

const mergeBronSpecifiek = (
  existing: BronSpecifiekJson,
  incoming: BronSpecifiekJson
): BronSpecifiekJson => {
  const left = asBronSpecifiekRecord(existing);
  const right = asBronSpecifiekRecord(incoming);
  const clearedKeys = new Set<string>();
  const overlays: BronSpecifiekRecord = {};
  for (const [key, value] of Object.entries(right)) {
    if (value === null || value === undefined) {
      continue;
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Zod record values are a union; blank/CLEARED strings are tombstones or noise
    if (typeof value === "string") {
      if (value.trim() === "") {
        continue;
      }
      if (value === CLEARED) {
        clearedKeys.add(key);
        continue;
      }
    }
    overlays[key] = value;
  }
  const merged: BronSpecifiekRecord = {};
  for (const [key, value] of Object.entries(left)) {
    if (!clearedKeys.has(key)) {
      merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overlays)) {
    merged[key] = value;
  }
  // SAFETY: merged is a Zod-validated string-keyed JSON object; BronSpecifiekJson
  // is the JsonValue object shape stored on curated.aanvraag.bron_specifiek.
  return merged as BronSpecifiekJson;
};

const toStoredFields = (
  input: CurateObservationInput
): Omit<StoredAanvraag, "aanvraagId"> => {
  const { draft } = input;
  // SAFETY: stripClearedBronSpecifiek only removes CLEARED string values; remaining
  // entries are still BronSpecifiekJson object shape for curated.aanvraag.bron_specifiek.
  const bronSpecifiek = stripClearedBronSpecifiek(
    asBronSpecifiekRecord(commercialBronSpecifiek(draft))
  ) as BronSpecifiekJson;
  const bronRecord = asBronSpecifiekRecord(bronSpecifiek);
  return {
    beschrijving: draft.beschrijving.value,
    bronId: input.bronId,
    bronReferentie: draft.bronReferentie.value,
    bronSpecifiek,
    bronUrl: draftTextColumn(draft.bronUrl.value),
    contentHash: draft.contentHash,
    contracttype: readBronText(bronRecord, "contracttype", "contract_type"),
    dedupGroepId: null,
    eersteGezienOp: input.observedAt,
    eindDatum: readBronText(bronRecord, "eind_datum", "eindDatum"),
    extractieMethode: draft.extractieMethode,
    laatstGezienOp: input.observedAt,
    locatieLand: draft.locatieLand.value,
    locatieTekst: draftTextColumn(draft.locatieTekst.value),
    opdrachtgeverNaam: draftTextColumn(draft.opdrachtgeverNaam.value),
    parserVersion: draft.parserVersion,
    provenance: buildProvenanceMap(draft),
    publicatiedatum: readBronText(
      bronRecord,
      "publicatiedatum",
      "gepubliceerd_op",
      "publicatie_datum",
      "json_ld_date_posted"
    ),
    rawPayloadRef: input.rawPayloadRef,
    scrapeRunId: input.scrapeRunId,
    sluitingsdatum: draft.sluitingsdatum ?? null,
    startDatum: draftTextColumn(draft.startDatum.value),
    status: draft.status,
    tariefEenheid: tariefColumn(draft.tarief.eenheid),
    tariefMax: tariefColumn(draft.tarief.max),
    tariefMin: tariefColumn(draft.tarief.min),
    tariefValuta: draft.tarief.valuta,
    titel: draft.titel.value,
    urenPerWeek: readBronText(bronRecord, "uren_per_week", "uren_per_week_raw"),
    versie: 1,
    werkvorm: readBronText(bronRecord, "werkvorm"),
  };
};

/** Shared with the lifecycle reconcile step so status-only versions carry the same snapshot shape. */
export const buildSnapshot = (stored: StoredAanvraag): AanvraagSnapshot => ({
  beschrijving: stored.beschrijving,
  bron_referentie: stored.bronReferentie,
  bron_specifiek: stored.bronSpecifiek,
  status: stored.status,
  tarief_eenheid: stored.tariefEenheid ?? UNKNOWN,
  tarief_max: stored.tariefMax ?? UNKNOWN,
  tarief_min: stored.tariefMin ?? UNKNOWN,
  titel: stored.titel,
});

const ensureDedupGroep = (
  store: CurateStore,
  draft: NormalisedAanvraagDraft
): Promise<StoredDedupGroep> =>
  store.ensureDedupGroep({
    dedupKey: buildDedupKey({
      opdrachtgeverNaam: draft.opdrachtgeverNaam.value,
      startDatum: draft.startDatum.value,
      titel: draft.titel.value,
    }),
  });

export const curateObservation = async (
  store: CurateStore,
  input: CurateObservationInput
): Promise<CurateObservationResult> => {
  const existing = await store.findAanvraagByIdentity(
    input.bronId,
    input.draft.bronReferentie.value
  );

  if (existing && existing.contentHash === input.draft.contentHash) {
    // ponytail: known gap — this branch writes a status change with NO outbox
    // event, so a draft whose status flips while the content hash stays equal
    // silently diverges the search index (the projection hash skips later
    // same-content events). Repair: bun run search:reconcile-projection —
    // see docs/runbooks/projection-repair.md.
    const { draft } = input;
    const patch: Partial<StoredAanvraag> = {
      laatstGezienOp: input.observedAt,
      status: draft.status,
    };
    // RJC-394 fix-first: an unchanged raw payload still needs to surface
    // locatie_tekst/sluitingsdatum on an already-curated row -- otherwise a
    // listing whose source content never changes again would never get
    // these columns filled, making the degraded (country-code/sentinel)
    // state permanent instead of transitional. These are derived fields
    // like `status` above, so this write does not bump `versie` or emit an
    // outbox event. Only write when the draft actually has a value: a
    // source that stops publishing a deadline must never silently erase a
    // value already stored from an earlier observation.

    if (draft.locatieTekst.value !== UNKNOWN) {
      patch.locatieTekst = draft.locatieTekst.value;
    }
    if (existing.opdrachtgeverNaam === null) {
      const value = draftTextColumn(draft.opdrachtgeverNaam.value);
      if (value !== null) {
        patch.opdrachtgeverNaam = value;
      }
    }
    if (existing.startDatum === null) {
      const value = draftTextColumn(draft.startDatum.value);
      if (value !== null) {
        patch.startDatum = value;
      }
    }
    if (existing.publicatiedatum === null) {
      const value = readBronText(
        asBronSpecifiekRecord(draft.bronSpecifiek.value),
        "publicatiedatum",
        "gepubliceerd_op",
        "publicatie_datum",
        "json_ld_date_posted"
      );
      if (value !== null) {
        patch.publicatiedatum = value;
      }
    }
    if (existing.contracttype === null) {
      const value = explicitBronText(draft, "contracttype", "contract_type");
      if (value !== null) {
        patch.contracttype = value;
      }
    }
    if (existing.werkvorm === null) {
      const value = explicitBronText(draft, "werkvorm");
      if (value !== null) {
        patch.werkvorm = value;
      }
    }
    if (draft.sluitingsdatum !== undefined) {
      patch.sluitingsdatum = draft.sluitingsdatum;
    }
    await store.updateAanvraag(existing.aanvraagId, patch);
    return { aanvraagId: existing.aanvraagId, status: "unchanged" };
  }

  // One transaction per mutation (RJC-399): versie + aanvraag + outbox
  // commit together, with the outbox insert last, so a crash can never
  // leave Postgres on a new status while the search index keeps the old.
  if (!existing) {
    return store.withTransaction(async (tx) => {
      const created = await tx.insertAanvraag(toStoredFields(input));
      const dedupGroep = await timeCriticalPathPhase("ingest-dedupe", () =>
        ensureDedupGroep(tx, input.draft)
      );
      await tx.linkAanvraagToDedupGroep(
        created.aanvraagId,
        dedupGroep.dedupGroepId
      );
      await tx.insertVersie({
        aanvraagId: created.aanvraagId,
        contentHash: created.contentHash,
        geldigTot: null,
        geldigVan: input.observedAt,
        rawPayloadRef: created.rawPayloadRef,
        scrapeRunId: created.scrapeRunId,
        snapshot: buildSnapshot(created),
        versie: 1,
      });
      const outbox = await timeCriticalPathPhase("ingest-outbox", () =>
        tx.insertOutboxEvent({
          aggregateId: created.aanvraagId,
          aggregateType: "aanvraag",
          eventType: "aanvraag.nieuw",
          payload: {
            bron_id: created.bronId,
            bron_referentie: created.bronReferentie,
            parser_version: created.parserVersion,
          },
        })
      );
      return {
        aanvraagId: created.aanvraagId,
        dedupGroepId: dedupGroep.dedupGroepId,
        outboxEventId: outbox.id,
        status: "curated",
        versie: 1,
      };
    });
  }

  const nextVersie = existing.versie + 1;
  const closedAt = input.observedAt;
  return store.withTransaction(async (tx) => {
    await tx.closeOpenVersie(existing.aanvraagId, closedAt);
    const next = toStoredFields(input);
    const { draft } = input;
    // Merge against commercialBronSpecifiek *before* strip so CLEARED
    // tombstones still reach mergeBronSpecifiek and drop prior JSON keys.
    // SAFETY: stripClearedBronSpecifiek only removes CLEARED strings; remainder
    // is still BronSpecifiekJson for curated.aanvraag.bron_specifiek.
    const mergedBronSpecifiek = stripClearedBronSpecifiek(
      asBronSpecifiekRecord(
        mergeBronSpecifiek(
          existing.bronSpecifiek,
          commercialBronSpecifiek(draft)
        )
      )
    ) as BronSpecifiekJson;
    const updated = await tx.updateAanvraag(existing.aanvraagId, {
      ...next,
      bronSpecifiek: mergedBronSpecifiek,
      bronUrl: applyCoalesce(
        coalescePatchFromDraft(draft.bronUrl.value),
        existing.bronUrl
      ),
      contracttype: coalesceNullable(
        explicitBronText(draft, "contracttype", "contract_type"),
        existing.contracttype
      ),
      dedupGroepId: existing.dedupGroepId,
      eersteGezienOp: existing.eersteGezienOp,
      eindDatum: coalesceNullable(next.eindDatum, existing.eindDatum),
      locatieTekst: applyCoalesce(
        coalescePatchFromDraft(draft.locatieTekst.value),
        existing.locatieTekst
      ),
      opdrachtgeverNaam: applyCoalesce(
        coalescePatchFromDraft(draft.opdrachtgeverNaam.value),
        existing.opdrachtgeverNaam
      ),
      publicatiedatum: coalesceNullable(
        next.publicatiedatum,
        existing.publicatiedatum
      ),
      sluitingsdatum: coalesceNullable(
        next.sluitingsdatum,
        existing.sluitingsdatum
      ),
      startDatum: applyCoalesce(
        coalescePatchFromDraft(draft.startDatum.value),
        existing.startDatum
      ),
      tariefEenheid: applyCoalesce(
        coalescePatchFromDraft(draft.tarief.eenheid),
        existing.tariefEenheid
      ),
      tariefMax: applyCoalesce(
        coalescePatchFromDraft(draft.tarief.max),
        existing.tariefMax
      ),
      tariefMin: applyCoalesce(
        coalescePatchFromDraft(draft.tarief.min),
        existing.tariefMin
      ),
      urenPerWeek: coalesceNullable(next.urenPerWeek, existing.urenPerWeek),
      versie: nextVersie,
      werkvorm: coalesceNullable(
        explicitBronText(draft, "werkvorm"),
        existing.werkvorm
      ),
    });
    await tx.insertVersie({
      aanvraagId: updated.aanvraagId,
      contentHash: updated.contentHash,
      geldigTot: null,
      geldigVan: closedAt,
      rawPayloadRef: updated.rawPayloadRef,
      scrapeRunId: updated.scrapeRunId,
      snapshot: buildSnapshot(updated),
      versie: nextVersie,
    });
    const outbox = await timeCriticalPathPhase("ingest-outbox", () =>
      tx.insertOutboxEvent({
        aggregateId: updated.aanvraagId,
        aggregateType: "aanvraag",
        eventType: "aanvraag.gewijzigd",
        payload: {
          content_hash: updated.contentHash,
          parser_version: updated.parserVersion,
        },
      })
    );
    return {
      aanvraagId: updated.aanvraagId,
      outboxEventId: outbox.id,
      status: "curated",
      versie: nextVersie,
    };
  });
};

export const splitDedupGroep = (
  store: CurateStore,
  dedupGroepId: string
): Promise<void> => store.splitDedupGroep(dedupGroepId);
