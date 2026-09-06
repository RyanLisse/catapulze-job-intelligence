import { getInternalServerUrl } from "@ji/env/web";
import { Badge } from "@ji/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ji/ui/components/card";
import { Skeleton } from "@ji/ui/components/skeleton";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  BronnenCardSparkline,
  BronnenSparklineHost,
  BronnenTrendPanel,
} from "@/app/bronnen/bronnen-charts";
import {
  aggregateTotalTrend,
  sparklineByBron,
} from "@/app/bronnen/bronnen-timeseries";
import type { BronTimeseriesPoint } from "@/app/bronnen/bronnen-timeseries";
import {
  canAccessBronnen,
  parseBronnenWindow,
  sessionRoleSchema,
  toDashboardApiWindow,
} from "@/app/bronnen/bronnen-window";
import type { BronnenWindow } from "@/app/bronnen/bronnen-window";
import { createCapabilityClient } from "@/features/job-intelligence/rest/capability-client";
import { getServerAuthClient } from "@/lib/auth-server";

export const metadata: Metadata = {
  description: "Gezondheid en opbrengst van alle ingestiebronnen.",
  title: "Bronnen · Catapulze Job Intelligence",
};

interface DashboardStats {
  readonly bronId: string | null;
  readonly gewijzigd: number;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly naam: string | null;
  readonly nieuw: number;
  readonly ongewijzigd: number;
  readonly rejected: number;
  readonly runs: number;
  readonly successRate: number | null;
}

interface DashboardHealth {
  readonly circuitStatus: string;
  readonly lastRunAt: string | null;
  readonly silenceAlertOpen: boolean;
}

interface DashboardBron {
  readonly health: DashboardHealth | null;
  readonly stats: DashboardStats;
}

interface DashboardOverview {
  readonly bronnen: readonly DashboardBron[];
  readonly timeseries: readonly BronTimeseriesPoint[];
  readonly total: DashboardStats;
}

const windowOptions: readonly {
  readonly label: string;
  readonly value: BronnenWindow;
}[] = [
  { label: "24 uur", value: "24h" },
  { label: "7 dagen", value: "7d" },
  { label: "30 dagen", value: "30d" },
];

const numberFormatter = new Intl.NumberFormat("nl-NL");

const getOverview = async (
  window: BronnenWindow
): Promise<DashboardOverview> => {
  const client = createCapabilityClient({
    baseUrl: getInternalServerUrl(),
  });
  return client.get<DashboardOverview>(
    `/v1/dashboard?window=${toDashboardApiWindow(window)}`,
    {
      headers: await headers(),
    }
  );
};

const formatRate = (rate: number | null): string =>
  rate === null ? "—" : `${Math.round(rate * 100)}%`;

const formatDate = (value: string | null): string =>
  value
    ? new Intl.DateTimeFormat("nl-NL", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Nog geen runs";

interface BronCardStatus {
  readonly label: "Aandacht" | "Gezond" | "Nieuw";
  readonly variant: "destructive" | "outline" | "secondary";
}

const statusFor = (bron: DashboardBron): BronCardStatus => {
  if (
    bron.health?.silenceAlertOpen ||
    bron.health?.circuitStatus === "open" ||
    bron.stats.lastRunStatus === "failed"
  ) {
    return {
      label: "Aandacht",
      variant: "destructive",
    } satisfies BronCardStatus;
  }
  if (bron.stats.runs === 0) {
    return { label: "Nieuw", variant: "outline" } satisfies BronCardStatus;
  }
  return { label: "Gezond", variant: "secondary" } satisfies BronCardStatus;
};

const Kpi = ({
  label,
  testId,
  value,
}: {
  readonly label: string;
  readonly testId: string;
  readonly value: string | number;
}) => (
  <Card data-testid={testId} size="sm">
    <CardContent className="space-y-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
    </CardContent>
  </Card>
);

const DashboardData = async ({
  window,
}: {
  readonly window: BronnenWindow;
}) => {
  const overview = await getOverview(window);
  const attentionCount = overview.bronnen.filter(
    (bron) => statusFor(bron).label !== "Gezond"
  ).length;
  const trend = aggregateTotalTrend(overview.timeseries);
  const sparklines = sparklineByBron(overview.timeseries);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi
          label="Runs"
          testId="bronnen-kpi-runs"
          value={numberFormatter.format(overview.total.runs)}
        />
        <Kpi
          label="Succes%"
          testId="bronnen-kpi-success"
          value={formatRate(overview.total.successRate)}
        />
        <Kpi
          label="Nieuw"
          testId="bronnen-kpi-nieuw"
          value={numberFormatter.format(overview.total.nieuw)}
        />
        <Kpi
          label="Gewijzigd"
          testId="bronnen-kpi-gewijzigd"
          value={numberFormatter.format(overview.total.gewijzigd)}
        />
        <Kpi
          label="Ongewijzigd"
          testId="bronnen-kpi-ongewijzigd"
          value={numberFormatter.format(overview.total.ongewijzigd)}
        />
        <Kpi
          label="Rejected"
          testId="bronnen-kpi-rejected"
          value={numberFormatter.format(overview.total.rejected)}
        />
        <Kpi
          label="Bronnen met aandacht"
          testId="bronnen-kpi-aandacht"
          value={numberFormatter.format(attentionCount)}
        />
      </div>

      <BronnenTrendPanel data={trend} />

      <section aria-labelledby="bronnen-heading" className="space-y-3">
        <div>
          <h2
            className="font-display text-xl font-semibold"
            id="bronnen-heading"
          >
            Bronkaarten
          </h2>
          <p className="text-sm text-muted-foreground">
            Operationele status per ingestiebron.
          </p>
        </div>

        {overview.bronnen.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nog geen bronnen geregistreerd.
            </CardContent>
          </Card>
        ) : (
          <BronnenSparklineHost>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {overview.bronnen.map((bron) => {
                const status = statusFor(bron);
                const { stats } = bron;

                return (
                  <Card data-bron-card key={stats.bronId ?? stats.naam}>
                    <CardHeader className="border-b">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle>{stats.naam ?? "Onbekende bron"}</CardTitle>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 pt-4 text-xs">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-muted-foreground">Runs</p>
                          <p className="font-mono font-semibold">
                            {numberFormatter.format(stats.runs)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Succes</p>
                          <p className="font-mono font-semibold">
                            {formatRate(stats.successRate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Nieuw</p>
                          <p className="font-mono font-semibold">
                            {numberFormatter.format(stats.nieuw)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Gewijzigd</p>
                          <p className="font-mono font-semibold">
                            {numberFormatter.format(stats.gewijzigd)}
                          </p>
                        </div>
                      </div>
                      <dl className="space-y-1.5 border-t border-border pt-3">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Circuit</dt>
                          <dd>{bron.health?.circuitStatus ?? "Onbekend"}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Stilte</dt>
                          <dd>
                            {bron.health?.silenceAlertOpen ? "Open" : "Nee"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Laatste run</dt>
                          <dd className="text-right">
                            {formatDate(
                              bron.health?.lastRunAt ?? stats.lastRunAt
                            )}
                          </dd>
                        </div>
                      </dl>
                      {stats.runs === 0 ? (
                        <p className="text-muted-foreground">Nog geen runs</p>
                      ) : null}
                      {stats.bronId ? (
                        <BronnenCardSparkline
                          bronName={stats.naam ?? "Onbekende bron"}
                          data={sparklines.get(stats.bronId) ?? []}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </BronnenSparklineHost>
        )}
      </section>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle>Hoe lees je deze cijfers?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Runs zijn uitgevoerde polls binnen het gekozen venster. Nieuw,
            gewijzigd en ongewijzigd tellen de verwerkte observaties.
          </p>
          <p>
            Een bron krijgt aandacht bij een open circuit, een mislukte laatste
            run of een stiltesignaal — het Motian PlatformHealthCard-patroon
            voor operatorgezondheid.
          </p>
        </CardContent>
      </Card>
    </>
  );
};

const LoadingState = () => (
  <div aria-label="Bronnen laden" className="space-y-5">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton className="h-20" key={index} />
      ))}
    </div>
    <Skeleton className="h-64 w-full" />
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton className="h-48" key={index} />
      ))}
    </div>
  </div>
);

export default async function BronnenPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ window?: string | string[] }>;
}) {
  const session = await getServerAuthClient().getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  const parsedSession = sessionRoleSchema.safeParse(session);
  if (
    !canAccessBronnen(
      parsedSession.success ? parsedSession.data.user.role : null
    )
  ) {
    redirect("/?toast=forbidden");
  }

  const params = await searchParams;
  const window = parseBronnenWindow(params.window);

  return (
    <main
      className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
      id="main-content"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            Operator monitor
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Bronnen
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Gezondheid, runs en opbrengst van je ingestiebronnen.{" "}
            <Link
              className="text-primary underline-offset-2 hover:underline"
              href="/bronnen/runs"
            >
              Bekijk scrape-runs
            </Link>
          </p>
        </div>
        <nav
          aria-label="Periode"
          className="flex flex-wrap gap-1 rounded-md border border-border p-1"
        >
          {windowOptions.map((option) => (
            <Link
              aria-current={window === option.value ? "page" : undefined}
              className={`rounded px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                window === option.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              href={`/bronnen?window=${option.value}`}
              key={option.value}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>
      <Suspense fallback={<LoadingState />}>
        <DashboardData window={window} />
      </Suspense>
    </main>
  );
}
