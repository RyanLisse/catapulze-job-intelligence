import type { BronId } from "@ji/domain";

export type SliceABronSlug = "inhuurdesk" | "tenderned";

export interface SliceABronDefinition {
  bronId: BronId;
  bronSlug: SliceABronSlug;
  naam: string;
}

export const SLICE_A_BRONNEN: readonly SliceABronDefinition[] = [
  {
    bronId: "00000000-0000-4000-8000-000000000001",
    bronSlug: "tenderned",
    naam: "TenderNed",
  },
  {
    bronId: "00000000-0000-4000-8000-000000000002",
    bronSlug: "inhuurdesk",
    naam: "Inhuurdesk",
  },
] as const;

export const resolveSliceABronSlug = (naam: string): SliceABronSlug | null => {
  const normalized = naam.trim().toLowerCase();
  if (normalized === "tenderned") {
    return "tenderned";
  }
  if (normalized === "inhuurdesk") {
    return "inhuurdesk";
  }
  return null;
};

export const sliceABronBySlug = (
  bronSlug: SliceABronSlug
): SliceABronDefinition | undefined =>
  SLICE_A_BRONNEN.find((bron) => bron.bronSlug === bronSlug);
