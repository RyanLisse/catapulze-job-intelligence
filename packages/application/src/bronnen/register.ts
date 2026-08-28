import type { BronConfig, BronId } from "@ji/domain";
import {
  activateBron,
  shouldScheduleBronPoll,
  validateBronConfig,
} from "@ji/domain";

export type BronLastRunSummary = {
  scrapeRunId: string;
  status: string;
  gestart: Date;
  aantalGevonden: number;
  nieuw: number;
  gewijzigd: number;
  fouten: number;
} | null;

export type BronRegisterRecord = BronConfig & {
  actief: boolean;
  lastRun: BronLastRunSummary;
};

export interface PublicBronView {
  bronId: BronId;
  naam: string;
  method: BronConfig["method"];
  interval: string;
  rateLimitPerMinute: number;
  crawlDelayMs: number;
  status: BronConfig["status"];
  voorwaardenStatus: BronConfig["voorwaardenStatus"];
  mappingRef: string | null;
  loginVereist: boolean;
  hasSecretRef: boolean;
  actief: boolean;
  lastRun: BronLastRunSummary;
}

export const toPublicBronView = (
  record: BronRegisterRecord
): PublicBronView => ({
  actief: record.actief,
  bronId: record.bronId,
  crawlDelayMs: record.crawlDelayMs,
  hasSecretRef: Boolean(record.secretRef),
  interval: record.interval,
  lastRun: record.lastRun,
  loginVereist: record.loginVereist,
  mappingRef: record.mappingRef,
  method: record.method,
  naam: record.naam,
  rateLimitPerMinute: record.rateLimitPerMinute,
  status: record.status,
  voorwaardenStatus: record.voorwaardenStatus,
});

export type CreateBronInput = Omit<BronConfig, "bronId"> & {
  bronId?: BronId;
  actief?: boolean;
};

export type CreateBronResult =
  | { ok: true; record: BronRegisterRecord }
  | { ok: false; issues: ReturnType<typeof validateBronConfig> };

export const createBron = (input: CreateBronInput): CreateBronResult => {
  const bronId = input.bronId ?? crypto.randomUUID();
  const record: BronRegisterRecord = {
    actief: input.actief ?? false,
    bronId,
    crawlDelayMs: input.crawlDelayMs,
    interval: input.interval,
    lastRun: null,
    loginVereist: input.loginVereist,
    mappingRef: input.mappingRef,
    method: input.method,
    naam: input.naam,
    rateLimitPerMinute: input.rateLimitPerMinute,
    secretRef: input.secretRef,
    status: input.status,
    voorwaardenStatus: input.voorwaardenStatus,
  };

  const issues = validateBronConfig(record);
  if (issues.length > 0) {
    return { issues, ok: false };
  }

  return { ok: true, record };
};

export interface ActivateBronRegisterInput {
  bronId: BronId;
  records: BronRegisterRecord[];
  testImportPassed: boolean;
}

export type ActivateBronRegisterResult =
  | { ok: true; record: BronRegisterRecord }
  | { ok: false; reason: string };

export const activateBronInRegister = (
  input: ActivateBronRegisterInput
): ActivateBronRegisterResult => {
  const record = input.records.find((entry) => entry.bronId === input.bronId);
  if (!record) {
    return { ok: false, reason: "bron not found" };
  }

  const activation = activateBron({
    config: record,
    testImportPassed: input.testImportPassed,
  });

  if (!activation.ok) {
    return activation;
  }

  return {
    ok: true,
    record: {
      ...record,
      actief: true,
      status: activation.status,
    },
  };
};

export const listPublicBronnen = (
  records: BronRegisterRecord[]
): PublicBronView[] => records.map(toPublicBronView);

export const isPollableBron = (record: BronRegisterRecord): boolean =>
  record.actief && shouldScheduleBronPoll(record);
