import {
  ArrowRight,
  DatabaseZap,
  Gauge,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { JOB_FIXTURES } from "@/features/job-intelligence/fixtures";
import {
  parseJobSearchState,
  searchJobs,
} from "@/features/job-intelligence/search-state";

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

const DashboardMetric = ({
  eyebrow,
  label,
  value,
}: {
  readonly eyebrow: string;
  readonly label: string;
  readonly value: string;
}) => (
  <div className="border-l border-foreground/14 pl-4 first:border-l-0 first:pl-0 sm:first:border-l sm:first:pl-4">
    <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
      {eyebrow}
    </p>
    <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">
      {value}
    </p>
    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
  </div>
);

const Home = () => {
  const activeJobs = JOB_FIXTURES.filter(({ status }) => status !== "closed");
  const sourceCount = new Set(
    activeJobs.flatMap(({ sourceRecords }) =>
      sourceRecords.map(({ name }) => name)
    )
  ).size;
  const remoteCount = activeJobs.filter(({ remote }) => remote).length;
  const savedSearchPreviews = savedSearches.map((savedSearch) => ({
    ...savedSearch,
    count: searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams({ q: savedSearch.query }))
    ).total,
  }));

  return (
    <main id="main-content" className="bg-[var(--ji-canvas)]">
      <section className="border-b border-white/8 bg-[var(--ji-ink)] text-[var(--ji-paper)]">
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-end lg:gap-16 lg:px-8">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="inline-flex min-h-7 items-center gap-2 border border-[var(--ji-signal)]/32 bg-[var(--ji-signal)]/8 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--ji-signal)] uppercase">
                <Sparkles aria-hidden="true" className="size-3" />
                Frontend foundation
              </span>
              <span className="text-xs text-white/52">
                Previewdata · REST-contract U7 volgt
              </span>
            </div>
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[var(--ji-warm)] uppercase">
              Recruiter command center
            </p>
            <h1 className="max-w-3xl text-4xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
              Vind de juiste opdracht vóór de rest.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/64 sm:text-lg">
              Eén snelle, herleidbare zoeklaag over publieke en private bronnen.
              Ontworpen om te lezen, vergelijken en beslissen zonder
              dashboardruis.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/jobs"
                className="inline-flex min-h-12 items-center justify-center gap-2 bg-[var(--ji-signal)] px-5 text-sm font-semibold text-[var(--ji-ink)] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ji-ink)]"
              >
                <Search aria-hidden="true" className="size-4" />
                Open job search
              </Link>
              <Link
                href="/jobs?q=Azure&freshness=30d"
                className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/18 px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-[var(--ji-signal)]"
              >
                Bekijk een zoekvoorbeeld
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-7 border-t border-white/12 pt-6 sm:grid-cols-4 lg:grid-cols-2">
            <DashboardMetric
              eyebrow="Actief"
              value={String(activeJobs.length)}
              label="synthetische opdrachten"
            />
            <DashboardMetric
              eyebrow="Bronnen"
              value={String(sourceCount)}
              label="kanalen in preview"
            />
            <DashboardMetric
              eyebrow="Hybride"
              value={String(remoteCount)}
              label="met remote optie"
            />
            <DashboardMetric
              eyebrow="Effecten"
              value="0"
              label="geen exportcontrol"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:px-8">
        <div className="border border-foreground/12 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.16em] text-[var(--ji-signal-strong)] uppercase">
                Bronsignaal
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">
                Nieuwe opdrachten per kanaal
              </h2>
            </div>
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[var(--ji-signal-strong)]" />
              Synthetische trend
            </span>
          </div>
          <div className="grid min-h-72 grid-cols-4 items-end gap-3 px-5 pt-8 pb-5 sm:gap-6 sm:px-7">
            {sourceActivity.map(({ label, value }) => (
              <div
                key={label}
                className="flex h-full flex-col justify-end gap-3"
              >
                <div className="relative flex flex-1 items-end border-b border-foreground/10">
                  <div
                    className="w-full bg-[var(--ji-ink)] dark:bg-[var(--ji-signal)]/72"
                    style={{ height: `${value}%` }}
                    aria-hidden="true"
                  />
                  <span className="absolute inset-x-0 -top-5 text-center text-xs font-semibold tabular-nums">
                    {value}
                  </span>
                </div>
                <p className="min-h-8 text-center text-[10px] leading-tight text-muted-foreground sm:text-xs">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-foreground/12 bg-card">
          <div className="border-b border-foreground/10 px-5 py-4">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[var(--ji-signal-strong)] uppercase">
              Startpunten
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Opgeslagen zoekvoorbeelden
            </h2>
          </div>
          <div className="divide-y divide-foreground/10">
            {savedSearchPreviews.map(({ count, label, query }) => (
              <Link
                key={label}
                href={{ pathname: "/jobs", query: { q: query } }}
                className="group flex min-h-20 items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-muted/70 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center border border-foreground/12 bg-background text-sm font-semibold tabular-nums">
                  {count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="ji-mono mt-1 block truncate text-[10px] text-muted-foreground">
                    {query}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1600px] gap-3 px-4 pb-10 sm:grid-cols-3 sm:px-6 lg:px-8">
        {[
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
            description:
              "REST vervangt straks de preview-adapter zonder UI-herbouw.",
            icon: DatabaseZap,
            title: "Klaar voor U7",
          },
        ].map(({ description, icon: Icon, title }) => (
          <article
            key={title}
            className="flex gap-4 border border-foreground/10 bg-card/55 p-5"
          >
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-[var(--ji-signal-strong)]"
            />
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
};

export default Home;
