export interface DashboardStats {
  readonly actief?: boolean | null;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly runs: number;
}

export interface DashboardHealth {
  readonly circuitStatus: string;
  readonly lastRunAt: string | null;
  readonly silenceAlertOpen: boolean;
}

export interface DashboardBron {
  readonly health: DashboardHealth | null;
  readonly stats: DashboardStats;
}

export interface BronCardStatus {
  readonly label: "Aandacht" | "Gezond" | "Inactief" | "Nieuw" | "Onbekend";
  readonly variant: "destructive" | "outline" | "secondary";
}

export type AttentionReason =
  | "silence-alert-open"
  | "circuit-open"
  | "last-run-failed";

export const attentionReasonLabels = {
  "circuit-open": "Circuit open",
  "last-run-failed": "Laatste run mislukt",
  "silence-alert-open": "Stiltesignaal open",
} satisfies Record<AttentionReason, string>;

export const attentionReasons = (
  bron: DashboardBron
): readonly AttentionReason[] => {
  const reasons: AttentionReason[] = [];
  if (bron.health?.silenceAlertOpen) {
    reasons.push("silence-alert-open");
  }
  if (bron.health?.circuitStatus === "open") {
    reasons.push("circuit-open");
  }
  if (bron.stats.lastRunStatus === "failed") {
    reasons.push("last-run-failed");
  }
  return reasons;
};

export const statusFor = (bron: DashboardBron): BronCardStatus => {
  if (bron.stats.actief === false) {
    return { label: "Inactief", variant: "outline" };
  }
  if (bron.stats.actief !== true) {
    return { label: "Onbekend", variant: "outline" };
  }
  if (attentionReasons(bron).length > 0) {
    return { label: "Aandacht", variant: "destructive" };
  }
  if (bron.stats.runs === 0) {
    return { label: "Nieuw", variant: "outline" };
  }
  return { label: "Gezond", variant: "secondary" };
};
