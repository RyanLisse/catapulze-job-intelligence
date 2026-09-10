import {
  ArrowUpRight,
  Building2,
  CalendarClock,
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
  readonly selectedJobId: string | null;
}

const ResultTitleButton = ({
  job,
  onSelect,
}: {
  readonly job: JobListing;
  readonly onSelect: JobResultsProps["onSelect"];
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
    <span className="mt-0.5 block text-[11px] text-muted-foreground">
      {job.organization ?? "Onbekend"}
    </span>
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

const DesktopResults = ({ jobs, onSelect, selectedJobId }: JobResultsProps) => (
  <div className="hidden min-[800px]:block">
    <table className="w-full table-fixed text-left text-xs">
      <caption className="sr-only">Gevonden opdrachten</caption>
      <thead className="bg-secondary/60 text-[11px] tracking-wide text-muted-foreground uppercase">
        <tr>
          <th scope="col" className="w-[38%] px-3 py-2 font-medium xl:w-[32%]">
            Opdracht
          </th>
          <th
            scope="col"
            className="hidden w-[16%] px-3 py-2 font-medium xl:table-cell"
          >
            Locatie
          </th>
          <th scope="col" className="w-[18%] px-3 py-2 font-medium">
            Tarief
          </th>
          <th scope="col" className="w-[16%] px-3 py-2 font-medium">
            Bron
          </th>
          <th scope="col" className="w-[16%] px-3 py-2 font-medium xl:w-[18%]">
            Timing
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.id}
            className={`border-t border-border transition-colors hover:bg-accent/60 ${
              selectedJobId === job.id ? "bg-accent" : ""
            }`}
          >
            <td className="px-3 py-2.5 align-top">
              <ResultTitleButton job={job} onSelect={onSelect} />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <JobStatus job={job} />
                <span className="text-[10px] text-muted-foreground">
                  {formatContract(job)}
                </span>
              </div>
            </td>
            <td className="hidden px-3 py-2.5 align-top text-muted-foreground xl:table-cell">
              {job.location ?? "Onbekend"}
              <span className="mt-0.5 block text-[10px]">
                {formatRemote(job)}
              </span>
            </td>
            <td className="px-3 py-2.5 align-top font-mono text-muted-foreground">
              {formatRate(job)}
            </td>
            <td className="px-3 py-2.5 align-top text-muted-foreground">
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

const MobileResults = ({ jobs, onSelect, selectedJobId }: JobResultsProps) => (
  <div className="grid gap-2 p-2 min-[800px]:hidden">
    {jobs.map((job) => (
      <article
        key={job.id}
        className={`rounded-lg border bg-card p-3 ${
          selectedJobId === job.id ? "border-primary" : "border-border"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <JobStatus job={job} />
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
