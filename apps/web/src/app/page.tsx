import {
  ArrowRight,
  ArrowUpRight,
  DatabaseZap,
  Gauge,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { JOB_FIXTURES } from "@/features/job-intelligence/fixtures";
import {
  parseJobSearchState,
  searchJobs,
} from "@/features/job-intelligence/search-state";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const CLOSING_SOON_DAYS = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const TOP_SKILL_COUNT = 14;
// The fixture set carries fixed publication and closing dates, so the
// coverage panel measures "sluit binnen 7 dagen" against the fixture
// epoch rather than Date.now() — otherwise this preview number silently
// decays to 0 as wall-clock time passes the fixtures.
const PREVIEW_REFERENCE_DATE = Date.parse("2026-09-01T00:00:00.000Z");

const numberFormatter = new Intl.NumberFormat("nl-NL");

const sourceActivity = [
  { label: "Inhuurdesk", value: 82 },
  { label: "Werken voor Nederland", value: 68 },
  { label: "TenderNed", value: 53 },
  { label: "Indeed", value: 36 },
] as const;

const savedSearches = [
  {
    label: "Data & platform",
    query: '(data OR platform) AND (Azure OR "Power BI")',
  },
  {
    label: "Security overheid",
    query: '(security OR "informatiebeveiliging") NOT junior',
  },
  {
    label: "Frontend TypeScript",
    query: "(React OR Next.js) AND TypeScript",
  },
] as const;

interface PanelProps {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly subtitle?: string;
  readonly title: string;
}

const Panel = ({ children, className = "", subtitle, title }: PanelProps) => (
  <section
    className={`rounded-lg border border-border bg-card p-4 ${className}`}
  >
    <div className="mb-3">
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
    {children}
  </section>
);

interface KpiProps {
  readonly accent?: boolean;
  readonly footer?: string;
  readonly label: string;
  readonly value: number;
}

const Kpi = ({ accent = false, footer, label, value }: KpiProps) => (
  <div className="rounded-lg border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p
      className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
        accent ? "text-primary" : "text-foreground"
      }`}
    >
      {numberFormatter.format(value)}
    </p>
    {footer ? (
      <p className="mt-1 text-[11px] text-muted-foreground">{footer}</p>
    ) : null}
  </div>
);

interface BarDatum {
  readonly label: string;
  readonly value: number;
}

const HorizontalBars = ({ data }: { readonly data: readonly BarDatum[] }) => {
  const highest = Math.max(...data.map(({ value }) => value), 1);

  return (
    <ul className="space-y-2.5">
      {data.map(({ label, value }, index) => (
        <li key={label} className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 truncate text-muted-foreground">
            {label}
          </span>
          <span className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
            <span
              className="block h-full rounded-sm"
              style={{
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                width: `${(value / highest) * 100}%`,
              }}
            />
          </span>
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {value}
          </span>
        </li>
      ))}
    </ul>
  );
};

interface CoverageDatum {
  readonly filled: number;
  readonly label: string;
  readonly total: number;
}

const CoverageBars = ({
  data,
}: {
  readonly data: readonly CoverageDatum[];
}) => (
  <ul className="space-y-2.5">
    {data.map(({ filled, label, total }) => {
      const percentage = Math.round((filled / total) * 100);

      return (
        <li key={label} className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 truncate text-muted-foreground">
            {label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.max(percentage, 1)}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {percentage}% · {filled}
          </span>
        </li>
      );
    })}
  </ul>
);

const capabilityCards = [
  {
    description:
      "Bron, referentie, run en normalisatie blijven bij elk resultaat.",
    icon: ShieldCheck,
    title: "Herkomst eerst",
  },
  {
    description:
      "URL-state en een lichte fixture-adapter houden interacties direct.",
    icon: Gauge,
    title: "Snel als standaard",
  },
  {
    description: "REST vervangt straks de preview-adapter zonder UI-herbouw.",
    icon: DatabaseZap,
    title: "Klaar voor U7",
  },
] as const;

const countSkills = (): readonly BarDatum[] => {
  const tally = new Map<string, number>();
  for (const { skills } of JOB_FIXTURES) {
    for (const skill of skills) {
      tally.set(skill, (tally.get(skill) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([label, value]) => ({ label, value }))
    .toSorted(
      (left, right) =>
        right.value - left.value || left.label.localeCompare(right.label, "nl")
    )
    .slice(0, TOP_SKILL_COUNT);
};

const Home = () => {
  const activeJobs = JOB_FIXTURES.filter(({ status }) => status !== "closed");
  const sourceCount = new Set(
    JOB_FIXTURES.flatMap(({ sourceRecords }) =>
      sourceRecords.map(({ name }) => name)
    )
  ).size;
  const remoteCount = JOB_FIXTURES.filter(({ remote }) => remote).length;
  const withRateCount = JOB_FIXTURES.filter(({ rate }) => rate !== null).length;
  const closingSoonCount = JOB_FIXTURES.filter(
    ({ closingAt }) =>
      Date.parse(closingAt) - PREVIEW_REFERENCE_DATE <
      CLOSING_SOON_DAYS * MILLISECONDS_PER_DAY
  ).length;
  const topSkills = countSkills();
  const savedSearchPreviews = savedSearches.map((savedSearch) => ({
    ...savedSearch,
    count: searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams({ q: savedSearch.query }))
    ).total,
  }));

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            Recruiter command center
          </p>
          <h1 className="mt-2 max-w-3xl font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Vind de juiste opdracht vóór de rest.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Eén snelle, herleidbare zoeklaag over publieke en private bronnen.
            Ontworpen om te lezen, vergelijken en beslissen zonder
            dashboardruis.
          </p>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Previewdata · REST-contract U7 volgt
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/jobs"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search aria-hidden="true" className="size-4" />
            Open job search
          </Link>
          <Link
            href="/jobs?q=Azure&freshness=30d"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Bekijk een zoekvoorbeeld
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Opdrachten in preview" value={JOB_FIXTURES.length} />
        <Kpi
          accent
          label="Actief"
          value={activeJobs.length}
          footer="open of sluit binnenkort"
        />
        <Kpi label="Bronnen" value={sourceCount} footer="kanalen in preview" />
        <Kpi label="Met remote optie" value={remoteCount} />
        <Kpi label="Zoekvoorbeelden" value={savedSearches.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Nieuwe opdrachten per kanaal"
          subtitle="Synthetische preview-trend, geen live ingestcijfers"
        >
          <HorizontalBars
            data={sourceActivity.map(({ label, value }) => ({ label, value }))}
          />
        </Panel>

        <Panel
          title="Opgeslagen zoekvoorbeelden"
          subtitle="Kies een voorbeeld om het in Zoeken te openen"
        >
          <ul className="divide-y divide-border">
            {savedSearchPreviews.map(({ count, label, query }) => (
              <li key={label}>
                <Link
                  href={{ pathname: "/jobs", query: { q: query } }}
                  className="group flex min-h-14 items-center gap-3 rounded-md px-2 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary font-mono text-xs tabular-nums">
                    {count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {query}
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Dekking van de previewdata"
          subtitle="Aandeel opdrachten waarvoor dit veld gevuld is"
        >
          <CoverageBars
            data={[
              {
                filled: withRateCount,
                label: "Tarief bekend",
                total: JOB_FIXTURES.length,
              },
              {
                filled: remoteCount,
                label: "Remote optie",
                total: JOB_FIXTURES.length,
              },
              {
                filled: activeJobs.length,
                label: "Nog actief",
                total: JOB_FIXTURES.length,
              },
              {
                filled: closingSoonCount,
                label: "Sluit binnen 7 dagen",
                total: JOB_FIXTURES.length,
              },
            ]}
          />
        </Panel>

        <Panel
          title="Skills in de previewset"
          subtitle="Kies een skill om ermee te zoeken"
        >
          <div className="flex flex-wrap gap-2">
            {topSkills.map(({ label, value }) => (
              <Link
                key={label}
                href={{ pathname: "/jobs", query: { q: `"${label}"` } }}
                className="group flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs outline-none transition-colors hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {value}
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {capabilityCards.map(({ description, icon: Icon, title }) => (
          <article
            key={title}
            className="flex gap-3 rounded-lg border border-border bg-card p-4"
          >
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <div>
              <h2 className="font-display text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
};

export default Home;
