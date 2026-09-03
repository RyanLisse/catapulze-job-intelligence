import type {
  AanvraagLifecycle,
  AanvraagId,
  BronId,
  ScrapeRunId,
} from "@ji/domain";
import { UNKNOWN } from "@ji/domain";
import { timeCriticalPathPhase } from "@ji/performance";

import type { NormalisedAanvraagDraft } from "../normalise";
import { buildDedupKey, buildProvenanceMap } from "../normalise";
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
  dedupGroepId: string | null;
  extractieMethode: string;
  eersteGezienOp: Date;
  laatstGezienOp: Date;
  locatieLand: string;
  locatieTekst: string | null;
  parserVersion: string;
  provenance: ProvenanceMap;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
  sluitingsdatum: Date | null;
  status: AanvraagLifecycle;
  tariefEenheid: string | null;
  tariefMax: string | null;
  tariefMin: string | null;
  tariefValuta: string;
  titel: string;
  versie: number;
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
  findDedupGroepByKey: (dedupKey: string) => Promise<StoredDedupGroep | null>;
  insertAanvraag: (
    input: Omit<StoredAanvraag, "aanvraagId">
  ) => Promise<StoredAanvraag>;
  insertDedupGroep: (input: { dedupKey: string }) => Promise<StoredDedupGroep>;
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

const tariefColumn = (value: string | typeof UNKNOWN): string | null =>
  value === UNKNOWN ? null : value;

const toStoredFields = (
  input: CurateObservationInput
): Omit<StoredAanvraag, "aanvraagId"> => {
  const { draft } = input;
  return {
    beschrijving: draft.beschrijving.value,
    bronId: input.bronId,
    bronReferentie: draft.bronReferentie.value,
    bronSpecifiek: draft.bronSpecifiek.value,
    bronUrl: draft.bronUrl.value === UNKNOWN ? null : draft.bronUrl.value,
    contentHash: draft.contentHash,
    dedupGroepId: null,
    eersteGezienOp: input.observedAt,
    extractieMethode: draft.extractieMethode,
    laatstGezienOp: input.observedAt,
    locatieLand: draft.locatieLand.value,
    locatieTekst:
      draft.locatieTekst.value === UNKNOWN ? null : draft.locatieTekst.value,
    parserVersion: draft.parserVersion,
    provenance: buildProvenanceMap(draft),
    rawPayloadRef: input.rawPayloadRef,
    scrapeRunId: input.scrapeRunId,
    sluitingsdatum: draft.sluitingsdatum ?? null,
    status: draft.status,
    tariefEenheid: tariefColumn(draft.tarief.eenheid),
    tariefMax: tariefColumn(draft.tarief.max),
    tariefMin: tariefColumn(draft.tarief.min),
    tariefValuta: draft.tarief.valuta,
    titel: draft.titel.value,
    versie: 1,
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

export const dedupKeyForDraft = (draft: NormalisedAanvraagDraft): string =>
  buildDedupKey({
    opdrachtgeverNaam: draft.opdrachtgeverNaam.value,
    startDatum: draft.startDatum.value,
    titel: draft.titel.value,
  });

const ensureDedupGroep = async (
  store: CurateStore,
  draft: NormalisedAanvraagDraft
): Promise<StoredDedupGroep | null> => {
  const dedupKey = dedupKeyForDraft(draft);
  const existing = await store.findDedupGroepByKey(dedupKey);
  if (existing) {
    return existing;
  }
  return store.insertDedupGroep({ dedupKey });
};

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
      if (dedupGroep) {
        await tx.linkAanvraagToDedupGroep(
          created.aanvraagId,
          dedupGroep.dedupGroepId
        );
      }
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
        dedupGroepId: dedupGroep?.dedupGroepId,
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
    const updated = await tx.updateAanvraag(existing.aanvraagId, {
      ...toStoredFields(input),
      dedupGroepId: existing.dedupGroepId,
      eersteGezienOp: existing.eersteGezienOp,
      versie: nextVersie,
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
