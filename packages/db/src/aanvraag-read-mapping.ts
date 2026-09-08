import { z } from "zod";

export interface AanvraagBronFacts {
  readonly contracttype: string | null;
  readonly opdrachtgeverNaam: string | null;
  readonly publicatiedatum: string | null;
  readonly startDatum: string | null;
  readonly werkvorm: string | null;
}

const PUBLICATION_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;

const sourceTextSchema = z
  .string()
  .refine((value) => value.trim() !== "")
  .nullable()
  .optional()
  // oxlint-disable-next-line promise/prefer-await-to-then -- Zod's synchronous fallback API, not Promise.catch
  .catch(null);

const bronFactsInputSchema = z.object({
  contract_type: sourceTextSchema,
  contracttype: sourceTextSchema,
  gepubliceerd_op: sourceTextSchema,
  opdrachtgeverNaam: sourceTextSchema,
  opdrachtgever_naam: sourceTextSchema,
  publicatiedatum: sourceTextSchema,
  startDatum: sourceTextSchema,
  start_datum: sourceTextSchema,
  werkvorm: sourceTextSchema,
});

const firstSourceText = (
  ...values: readonly (null | string | undefined)[]
): string | null =>
  values.find((value) => value !== null && value !== undefined) ?? null;

const publicationDate = (
  values: z.output<typeof bronFactsInputSchema>
): string | null => {
  const value = firstSourceText(values.publicatiedatum, values.gepubliceerd_op);
  if (value === null) {
    return null;
  }
  if (
    !PUBLICATION_DATE_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null;
  }
  return value;
};

export const readAanvraagBronFacts = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- curated JSON I/O boundary is parsed by bronFactsInputSchema before field access
  bronSpecifiek: unknown
): AanvraagBronFacts => {
  const parsed = bronFactsInputSchema.safeParse(bronSpecifiek);
  if (!parsed.success) {
    return {
      contracttype: null,
      opdrachtgeverNaam: null,
      publicatiedatum: null,
      startDatum: null,
      werkvorm: null,
    };
  }
  const values = parsed.data;
  return {
    contracttype: firstSourceText(values.contracttype, values.contract_type),
    opdrachtgeverNaam: firstSourceText(
      values.opdrachtgeverNaam,
      values.opdrachtgever_naam
    ),
    publicatiedatum: publicationDate(values),
    startDatum: firstSourceText(values.startDatum, values.start_datum),
    werkvorm: values.werkvorm ?? null,
  };
};
