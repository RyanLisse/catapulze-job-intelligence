import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  MapPin,
  RadioTower,
} from "lucide-react";

import {
  contractLabels,
  formatDate,
  formatRate,
  primarySource,
} from "./presentation";
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
    className="group min-h-11 max-w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span className="flex items-start gap-2 font-semibold tracking-tight text-foreground group-hover:text-[var(--ji-signal-strong)] dark:group-hover:text-[var(--ji-signal)]">
      <span>{job.title}</span>
      <ArrowUpRight
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 opacity-45 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
      />
    </span>
    <span className="mt-1 block text-xs text-muted-foreground">
      {job.organization}
    </span>
  </button>
);

const JobStatus = ({ job }: { readonly job: JobListing }) => (
  <span
    className={`inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase ${
      job.status === "closing-soon"
        ? "text-amber-700 dark:text-amber-300"
        : "text-[var(--ji-signal-strong)] dark:text-[var(--ji-signal)]"
    }`}
  >
    <span
      className={`size-1.5 rounded-full ${
        job.status === "closing-soon"
          ? "bg-amber-600 dark:bg-amber-300"
          : "bg-[var(--ji-signal-strong)] dark:bg-[var(--ji-signal)]"
      }`}
    />
    {job.status === "closing-soon" ? "Sluit snel" : "Open"}
  </span>
);

const DesktopResults = ({ jobs, onSelect, selectedJobId }: JobResultsProps) => (
  <div className="hidden min-[800px]:block">
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">Gevonden opdrachten</caption>
      <thead>
        <tr className="border-b border-foreground/12 bg-muted/45 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <th scope="col" className="w-[38%] px-4 py-3 xl:w-[32%]">
            Opdracht
          </th>
          <th scope="col" className="hidden w-[16%] px-4 py-3 xl:table-cell">
            Locatie
          </th>
          <th scope="col" className="w-[18%] px-4 py-3">
            Tarief
          </th>
          <th scope="col" className="w-[16%] px-4 py-3">
            Bron
          </th>
          <th scope="col" className="w-[16%] px-4 py-3 xl:w-[18%]">
            Timing
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-foreground/10">
        {jobs.map((job) => (
          <tr
            key={job.id}
            className={`transition-colors hover:bg-muted/45 ${
              selectedJobId === job.id ? "bg-accent/55" : ""
            }`}
          >
            <td className="px-4 py-3 align-top">
              <ResultTitleButton job={job} onSelect={onSelect} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <JobStatus job={job} />
                <span className="text-[10px] text-muted-foreground">
                  {contractLabels[job.contractType]}
                </span>
              </div>
            </td>
            <td className="hidden px-4 py-4 align-top text-xs text-foreground/72 xl:table-cell">
              {job.location}
              <span className="mt-1 block text-[10px] text-muted-foreground">
                {job.remote ? "Hybride" : "Op locatie"}
              </span>
            </td>
            <td className="px-4 py-4 align-top text-xs font-medium">
              {formatRate(job)}
            </td>
            <td className="px-4 py-4 align-top text-xs text-foreground/72">
              {primarySource(job)}
              <span className="ji-mono mt-1 block text-[9px] text-muted-foreground">
                {job.sourceRecords[0]?.reference ?? "—"}
              </span>
            </td>
            <td className="px-4 py-4 align-top text-xs text-foreground/72">
              <time dateTime={job.publishedAt}>
                {formatDate(job.publishedAt)}
              </time>
              <span className="mt-1 block text-[10px] text-muted-foreground">
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
  <div className="grid gap-3 p-3 min-[800px]:hidden">
    {jobs.map((job) => (
      <article
        key={job.id}
        className={`border bg-card p-4 ${
          selectedJobId === job.id
            ? "border-[var(--ji-signal-strong)]"
            : "border-foreground/12"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <JobStatus job={job} />
          <span className="text-[10px] font-medium text-muted-foreground">
            {contractLabels[job.contractType]}
          </span>
        </div>
        <div className="mt-3">
          <ResultTitleButton job={job} onSelect={onSelect} />
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {job.summary}
        </p>
        <dl className="mt-4 grid gap-2 border-t border-foreground/10 pt-3 text-xs">
          <div className="flex items-start gap-2">
            <MapPin
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Locatie</dt>
            <dd>
              {job.location}
              {job.remote ? " · hybride" : ""}
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <RadioTower
              aria-hidden="true"
              className="mt-0.5 size-3.5 text-muted-foreground"
            />
            <dt className="sr-only">Tarief</dt>
            <dd>{formatRate(job)}</dd>
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
