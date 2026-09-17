import { Checkbox } from "@ji/ui/components/checkbox";
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Clock3,
  MapPin,
  RadioTower,
} from "lucide-react";

import {
  formatContract,
  formatDate,
  formatRate,
  formatRemote,
  primarySource,
} from "./presentation";
import { stripHtmlToText } from "./sanitize-job-html";
import type { JobListing } from "./types";

interface JobResultsProps {
  readonly jobs: readonly JobListing[];
  readonly onSelect: (job: JobListing, trigger: HTMLButtonElement) => void;
  readonly onTogglePage?: () => void;
  readonly onToggleRow?: (id: string) => void;
  readonly pageFullySelected?: boolean;
  readonly selectedJobId: string | null;
  readonly selectedIds?: ReadonlySet<string>;
}

const ResultTitleButton = ({
  job,
  onSelect,
  showOrganization = true,
}: {
  readonly job: JobListing;
  readonly onSelect: JobResultsProps["onSelect"];
  readonly showOrganization?: boolean;
}) => (
  <button
    type="button"
    onClick={(event) => onSelect(job, event.currentTarget)}
    className="group max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span className="flex items-start gap-1.5 font-medium text-foreground transition-colors group-hover:text-primary">
      <span className="line-clamp-2">{job.title}</span>
      <ArrowUpRight
        aria-hidden="true"
        className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </span>
    {showOrganization ? (
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {job.organization ?? "Onbekend"}
      </span>
    ) : null}
  </button>
);

const jobStatusPresentation = {
  closed: {
    dotClassName: "bg-muted-foreground",
    label: "Gesloten",
    textClassName: "text-muted-foreground",
  },
  "closing-soon": {
    dotClassName: "bg-chart-2",
    label: "Sluit snel",
    textClassName: "text-chart-2",
  },
  open: {
    dotClassName: "bg-primary",
    label: "Open",
    textClassName: "text-primary",
  },
} satisfies Record<
  JobListing["status"],
  {
    readonly dotClassName: string;
    readonly label: string;
    readonly textClassName: string;
  }
>;

const JobStatus = ({ job }: { readonly job: JobListing }) => {
  const status = jobStatusPresentation[job.status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase ${status.textClassName}`}
    >
      <span className={`size-1.5 rounded-full ${status.dotClassName}`} />
      {status.label}
    </span>
  );
};

const resultRowBackground = (
  job: JobListing,
  selectedJobId: string | null,
  selectedIds: ReadonlySet<string> | undefined
): string => {
  if (selectedJobId === job.id) {
    return "bg-accent";
  }
  return selectedIds?.has(job.id) ? "bg-primary/10" : "";
};

const DesktopResults = ({
  jobs,
  onSelect,
  onTogglePage,
  onToggleRow,
  pageFullySelected = false,
  selectedJobId,
  selectedIds,
}: JobResultsProps) => (
  <div className="hidden overflow-x-auto min-[800px]:block">
    <table className="min-w-[960px] w-full table-fixed text-left text-xs">
      <caption className="sr-only">Gevonden opdrachten</caption>
      <colgroup>
        <col className="w-[4%]" />
        <col className="w-[24%]" />
        <col className="w-[17%]" />
        <col className="w-[16%]" />
        <col className="w-[12%]" />
        <col className="w-[8%]" />
        <col className="w-[11%]" />
        <col className="w-[8%]" />
      </colgroup>
      <thead className="bg-secondary/60 text-[11px] tracking-wide text-muted-foreground uppercase">
        <tr>
          <th scope="col" className="px-3 py-2 font-medium">
            <Checkbox
              aria-label="Selecteer alle resultaten op deze pagina"
              checked={pageFullySelected}
              onCheckedChange={onTogglePage}
              className="size-4 accent-primary"
            />
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Title
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Company
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Location
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Rate
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Hrs
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Platform
          </th>
          <th scope="col" className="px-3 py-2 font-medium">
            Posted
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.id}
            className={`border-t border-border transition-colors hover:bg-accent/60 ${resultRowBackground(job, selectedJobId, selectedIds)}`}
          >
            <td className="px-3 py-2.5 align-top">
              <Checkbox
                aria-label={`Selecteer ${job.title}`}
                checked={selectedIds?.has(job.id) ?? false}
                onCheckedChange={() => onToggleRow?.(job.id)}
                className="size-4 accent-primary"
              />
            </td>
            <td className="px-3 py-2.5 align-top">
              <ResultTitleButton
                job={job}
                onSelect={onSelect}
                showOrganization={false}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <JobStatus job={job} />
                <span className="text-[10px] text-muted-foreground">
                  {formatContract(job)}
                </span>
              </div>
            </td>
            <td className="truncate px-3 py-2.5 align-top text-muted-foreground">
              {job.organization ?? "Onbekend"}
            </td>
            <td className="truncate px-3 py-2.5 align-top text-muted-foreground">
              {job.location ?? "Onbekend"}
              <span className="mt-0.5 block text-[10px]">
                {formatRemote(job)}
              </span>
            </td>
            <td className="px-3 py-2.5 align-top font-mono text-muted-foreground">
              <span className="whitespace-nowrap">{formatRate(job)}</span>
            </td>
            <td className="px-3 py-2.5 align-top font-mono text-muted-foreground">
              {job.hoursPerWeek ?? "Onbekend"}
            </td>
            <td className="truncate px-3 py-2.5 align-top text-muted-foreground">
              {primarySource(job)}
              <span className="mt-0.5 block font-mono text-[10px]">
                {job.sourceRecords[0]?.reference ?? "—"}
              </span>
            </td>
            <td className="px-3 py-2.5 align-top text-muted-foreground">
              <time
                className="font-mono"
                dateTime={job.publishedAt ?? undefined}
              >
                {formatDate(job.publishedAt)}
              </time>
              <span className="mt-0.5 block text-[10px]">
                Sluit {formatDate(job.closingAt)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MobileResults = ({
  jobs,
  onSelect,
  onToggleRow,
  selectedJobId,
  selectedIds,
}: JobResultsProps) => (
  <div className="grid gap-2 p-2 min-[800px]:hidden">
    {jobs.map((job) => (
      <article
        key={job.id}
        className={`rounded-lg border bg-card p-3 ${
          selectedJobId === job.id ? "border-primary" : "border-border"
        } ${selectedJobId !== job.id && selectedIds?.has(job.id) ? "bg-primary/10" : ""}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="sr-only">Selecteer {job.title}</span>
            <Checkbox
              aria-label={`Selecteer ${job.title}`}
              checked={selectedIds?.has(job.id) ?? false}
              onCheckedChange={() => onToggleRow?.(job.id)}
              className="size-4 accent-primary"
            />
            <JobStatus job={job} />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {formatContract(job)}
          </span>
        </div>
        <div className="mt-2">
          <ResultTitleButton job={job} onSelect={onSelect} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {stripHtmlToText(job.summary) || job.summary}
        </p>
        <dl className="mt-3 grid gap-1.5 border-t border-border pt-2.5 text-xs">
          <div className="flex items-start gap-2">
            <MapPin
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Locatie</dt>
            <dd>
              {job.location ?? "Onbekend"} · {formatRemote(job)}
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <RadioTower
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Tarief</dt>
            <dd className="font-mono">{formatRate(job)}</dd>
          </div>
          <div className="flex items-start gap-2">
            <Clock3
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Uren per week</dt>
            <dd className="font-mono">{job.hoursPerWeek ?? "Onbekend"}</dd>
          </div>
          <div className="flex items-start gap-2">
            <Building2
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Bron</dt>
            <dd>{primarySource(job)}</dd>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground">
            <CalendarClock aria-hidden="true" className="mt-0.5 size-3.5" />
            <dt className="sr-only">Publicatie en sluiting</dt>
            <dd>
              {formatDate(job.publishedAt)} · sluit {formatDate(job.closingAt)}
            </dd>
          </div>
        </dl>
      </article>
    ))}
  </div>
);

export const JobResults = (props: JobResultsProps) => (
  <>
    <DesktopResults {...props} />
    <MobileResults {...props} />
  </>
);
