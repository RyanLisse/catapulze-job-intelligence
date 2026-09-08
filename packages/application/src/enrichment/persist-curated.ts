import { CLEARED, UNKNOWN } from "@ji/domain";
import { z } from "zod";

import type {
  EnrichmentContractValue,
  EnrichmentField,
  EnrichmentFieldValue,
  EnrichmentLocatieValue,
  EnrichmentProposal,
  EnrichmentRemoteValue,
  EnrichmentTariefValue,
} from "./types";
import { ENRICHMENT_APPLY_MIN_CONFIDENCE } from "./types";

/**
 * Curated commercial facts enrichment may fill. CLEARED means a true clear
 * tombstone from #213 coalesce — never resurrect those keys.
 */
export interface CuratedCommercialFacts {
  readonly bronSpecifiek?: unknown;
  readonly contracttype: string | null;
  readonly locatieTekst: string | null;
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
  readonly tariefValuta: string | null;
  readonly werkvorm: string | null;
}

export interface CuratedEnrichmentPatch {
  readonly contracttype?: string;
  readonly fields: readonly EnrichmentField[];
  readonly locatieTekst?: string;
  readonly tariefEenheid?: string;
  readonly tariefMax?: string;
  readonly tariefMin?: string;
  readonly tariefValuta?: string;
  readonly werkvorm?: string;
}

class PatchBuilder {
  contracttype?: string;
  locatieTekst?: string;
  tariefEenheid?: string;
  tariefMax?: string;
  tariefMin?: string;
  tariefValuta?: string;
  werkvorm?: string;
  readonly fields: EnrichmentField[] = [];

  addLocatie(value: string): void {
    this.locatieTekst = value;
    this.fields.push("locatie");
  }

  addTarief(parts: {
    readonly eenheid: string | null;
    readonly max: string | null;
    readonly min: string | null;
    readonly valuta: string | null;
  }): void {
    if (parts.min !== null) {
      this.tariefMin = parts.min;
    }
    if (parts.max !== null) {
      this.tariefMax = parts.max;
    }
    if (parts.eenheid !== null) {
      this.tariefEenheid = parts.eenheid;
    }
    if (parts.valuta !== null) {
      this.tariefValuta = parts.valuta;
    }
    this.fields.push("tarief");
  }

  addContract(value: string): void {
    this.contracttype = value;
    this.fields.push("contract");
  }

  addRemote(value: string): void {
    this.werkvorm = value;
    this.fields.push("remote");
  }

  build(): CuratedEnrichmentPatch | null {
    if (this.fields.length === 0) {
      return null;
    }
    const result: CuratedEnrichmentPatch = { fields: this.fields };
    if (this.locatieTekst !== undefined) {
      Object.assign(result, { locatieTekst: this.locatieTekst });
    }
    if (this.tariefEenheid !== undefined) {
      Object.assign(result, { tariefEenheid: this.tariefEenheid });
    }
    if (this.tariefMax !== undefined) {
      Object.assign(result, { tariefMax: this.tariefMax });
    }
    if (this.tariefMin !== undefined) {
      Object.assign(result, { tariefMin: this.tariefMin });
    }
    if (this.tariefValuta !== undefined) {
      Object.assign(result, { tariefValuta: this.tariefValuta });
    }
    if (this.contracttype !== undefined) {
      Object.assign(result, { contracttype: this.contracttype });
    }
    if (this.werkvorm !== undefined) {
      Object.assign(result, { werkvorm: this.werkvorm });
    }
    return result;
  }
}

const sourceTextSchema = z
  .string()
  .refine((value) => value.trim() !== "")
  .nullable()
  .optional()
  // oxlint-disable-next-line promise/prefer-await-to-then -- Zod synchronous fallback API
  .catch(null);

const bronClearedSchema = z
  .object({
    contract_type: sourceTextSchema,
    contracttype: sourceTextSchema,
    locatie: sourceTextSchema,
    locatieTekst: sourceTextSchema,
    locatie_tekst: sourceTextSchema,
    tarief: sourceTextSchema,
    tariefEenheid: sourceTextSchema,
    tariefMax: sourceTextSchema,
    tariefMin: sourceTextSchema,
    tarief_eenheid: sourceTextSchema,
    tarief_max: sourceTextSchema,
    tarief_min: sourceTextSchema,
    werkvorm: sourceTextSchema,
  })
  .passthrough();

const isMissingText = (value: string | null | undefined): boolean =>
  value === null ||
  value === undefined ||
  value.trim() === "" ||
  value.trim() === UNKNOWN;

const isClearedText = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && value.trim() === CLEARED;

const isMissingTarief = (facts: CuratedCommercialFacts): boolean =>
  isMissingText(facts.tariefMin) &&
  isMissingText(facts.tariefMax) &&
  isMissingText(facts.tariefEenheid);

const isClearedTarief = (facts: CuratedCommercialFacts): boolean =>
  isClearedText(facts.tariefMin) ||
  isClearedText(facts.tariefMax) ||
  isClearedText(facts.tariefEenheid);

const asLocatie = (
  value: EnrichmentFieldValue
): EnrichmentLocatieValue | null => ("locatieTekst" in value ? value : null);

const asTarief = (value: EnrichmentFieldValue): EnrichmentTariefValue | null =>
  "eenheid" in value && "valuta" in value ? value : null;

const asContract = (
  value: EnrichmentFieldValue
): EnrichmentContractValue | null =>
  "contracttype" in value && !("werkvorm" in value) ? value : null;

const asRemote = (value: EnrichmentFieldValue): EnrichmentRemoteValue | null =>
  "werkvorm" in value ? value : null;

const readBronClearedKeys = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- curated JSON I/O boundary; parsed by bronClearedSchema before field access
  bronSpecifiek: unknown
): ReadonlySet<string> => {
  const cleared = new Set<string>();
  const parsed = bronClearedSchema.safeParse(bronSpecifiek);
  if (!parsed.success) {
    return cleared;
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === CLEARED) {
      cleared.add(key);
    }
  }
  return cleared;
};

const locatieCleared = (
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>
): boolean =>
  isClearedText(facts.locatieTekst) ||
  bronCleared.has("locatie") ||
  bronCleared.has("locatie_tekst") ||
  bronCleared.has("locatieTekst");

const contractCleared = (
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>
): boolean =>
  isClearedText(facts.contracttype) ||
  bronCleared.has("contracttype") ||
  bronCleared.has("contract_type");

const remoteCleared = (
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>
): boolean => isClearedText(facts.werkvorm) || bronCleared.has("werkvorm");

const tariefCleared = (
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>
): boolean =>
  isClearedTarief(facts) ||
  bronCleared.has("tarief") ||
  bronCleared.has("tarief_min") ||
  bronCleared.has("tarief_max") ||
  bronCleared.has("tarief_eenheid") ||
  bronCleared.has("tariefMin") ||
  bronCleared.has("tariefMax") ||
  bronCleared.has("tariefEenheid");

const normalizeTariefPart = (raw: string): string | null => {
  if (isMissingText(raw) || isClearedText(raw)) {
    return null;
  }
  return raw.trim();
};

const tryAddLocatie = (
  builder: PatchBuilder,
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>,
  proposal: EnrichmentProposal
): void => {
  if (
    locatieCleared(facts, bronCleared) ||
    !isMissingText(facts.locatieTekst)
  ) {
    return;
  }
  const value = asLocatie(proposal.value);
  if (
    !value ||
    isMissingText(value.locatieTekst) ||
    isClearedText(value.locatieTekst)
  ) {
    return;
  }
  builder.addLocatie(value.locatieTekst.trim());
};

const tryAddTarief = (
  builder: PatchBuilder,
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>,
  proposal: EnrichmentProposal
): void => {
  if (tariefCleared(facts, bronCleared) || !isMissingTarief(facts)) {
    return;
  }
  const value = asTarief(proposal.value);
  if (!value) {
    return;
  }
  const min = normalizeTariefPart(value.min);
  const max = normalizeTariefPart(value.max);
  const eenheid = normalizeTariefPart(value.eenheid);
  const valuta = normalizeTariefPart(value.valuta);
  if (min === null && max === null && eenheid === null) {
    return;
  }
  builder.addTarief({ eenheid, max, min, valuta });
};

const tryAddContract = (
  builder: PatchBuilder,
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>,
  proposal: EnrichmentProposal
): void => {
  if (
    contractCleared(facts, bronCleared) ||
    !isMissingText(facts.contracttype)
  ) {
    return;
  }
  const value = asContract(proposal.value);
  if (
    !value ||
    isMissingText(value.contracttype) ||
    isClearedText(value.contracttype)
  ) {
    return;
  }
  builder.addContract(value.contracttype.trim());
};

const tryAddRemote = (
  builder: PatchBuilder,
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>,
  proposal: EnrichmentProposal
): void => {
  if (remoteCleared(facts, bronCleared) || !isMissingText(facts.werkvorm)) {
    return;
  }
  const value = asRemote(proposal.value);
  if (
    !value ||
    isMissingText(value.werkvorm) ||
    isClearedText(value.werkvorm)
  ) {
    return;
  }
  builder.addRemote(value.werkvorm.trim());
};

const applyProposal = (
  builder: PatchBuilder,
  facts: CuratedCommercialFacts,
  bronCleared: ReadonlySet<string>,
  proposal: EnrichmentProposal
): void => {
  if (proposal.confidence < ENRICHMENT_APPLY_MIN_CONFIDENCE) {
    return;
  }
  switch (proposal.field) {
    case "locatie": {
      tryAddLocatie(builder, facts, bronCleared, proposal);
      return;
    }
    case "tarief": {
      tryAddTarief(builder, facts, bronCleared, proposal);
      return;
    }
    case "contract": {
      tryAddContract(builder, facts, bronCleared, proposal);
      return;
    }
    case "remote": {
      tryAddRemote(builder, facts, bronCleared, proposal);
      return;
    }
    default: {
      const _exhaustive: never = proposal.field;
      return _exhaustive;
    }
  }
};

/**
 * Plan curated commercial column writes from high-confidence enrichment
 * proposals. #213 CLEARED coalesce wins: cleared keys are never resurrected;
 * published bron values are never overwritten; only null/unknown gaps fill.
 */
export const planCuratedEnrichmentPatch = (
  facts: CuratedCommercialFacts,
  proposals: readonly EnrichmentProposal[]
): CuratedEnrichmentPatch | null => {
  const bronCleared = readBronClearedKeys(facts.bronSpecifiek);
  const builder = new PatchBuilder();
  for (const proposal of proposals) {
    applyProposal(builder, facts, bronCleared, proposal);
  }
  return builder.build();
};
