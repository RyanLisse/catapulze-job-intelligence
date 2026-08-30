import {
  Building2,
  CalendarClock,
  ExternalLink,
  FileJson2,
  MapPin,
  RadioTower,
  X,
} from "lucide-react";

import {
  contractLabels,
  formatDate,
  formatRate,
  sourceLabels,
} from "./presentation";
import type { JobListing } from "./types";

interface DetailFactProps {
  readonly icon: typeof Building2;
  readonly label: string;
  readonly value: string;
}

const DetailFact = ({ icon: Icon, label, value }: DetailFactProps) => (
  <div className="flex gap-3 border-b border-foreground/10 py-3 last:border-b-0">
    <Icon
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-[var(--ji-signal-strong)] dark:text-[var(--ji-signal)]"
    />
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  </div>
);

interface JobDetailProps {
  readonly descriptionId: string;
  readonly job: JobListing;
  readonly onClose: () => void;
  readonly titleId: string;
}

export const JobDetail = ({
  descriptionId,
  job,
  onClose,
  titleId,
}: JobDetailProps) => {
  const rawPreview = JSON.stringify(
    {
      contract_type: job.contractType,
      description: job.description,
      location: job.location,
      organization: job.organization,
      skills: job.skills,
      title: job.title,
    },
    null,
    2
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-start gap-4 border-b border-foreground/10 px-5 py-5">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="border border-[var(--ji-signal-strong)]/25 bg-[var(--ji-signal-strong)]/8 px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--ji-signal-strong)] uppercase dark:text-[var(--ji-signal)]">
              {contractLabels[job.contractType]}
            </span>
            {job.status === "closing-soon" ? (
              <span className="border border-amber-600/25 bg-amber-600/8 px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-amber-700 uppercase dark:text-amber-300">
                Sluit binnenkort
              </span>
            ) : null}
          </div>
          <h2
            id={titleId}
            className="text-xl leading-tight font-semibold tracking-[-0.025em]"
          >
            {job.title}
          </h2>
          <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
            {job.organization} · {job.location}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Vacaturedetail sluiten"
          className="grid size-11 shrink-0 place-items-center border border-foreground/12 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section className="px-5 py-5" aria-labelledby={`${titleId}-summary`}>
          <h3
            id={`${titleId}-summary`}
            className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase"
          >
            Opdracht
          </h3>
          <p className="mt-3 text-sm leading-relaxed">{job.summary}</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground/70">
            {job.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {job.skills.map((skill) => (
              <span
                key={skill}
                className="border border-foreground/10 bg-muted px-2 py-1 text-[11px]"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>

        <section className="border-t border-foreground/10 px-5 py-5">
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Kerngegevens
          </h3>
          <dl className="mt-2">
            <DetailFact
              icon={Building2}
              label="Organisatie"
              value={job.organization}
            />
            <DetailFact
              icon={MapPin}
              label="Werkvorm"
              value={`${job.location}${job.remote ? " · hybride" : " · op locatie"}`}
            />
            <DetailFact
              icon={CalendarClock}
              label="Publicatie en sluiting"
              value={`${formatDate(job.publishedAt)} · sluit ${formatDate(job.closingAt)}`}
            />
            <DetailFact
              icon={RadioTower}
              label="Tarief"
              value={formatRate(job)}
            />
          </dl>
        </section>

        <section className="border-t border-foreground/10 px-5 py-5">
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Herkomst
          </h3>
          <div className="mt-3 space-y-3">
            {job.sourceRecords.map((record) => (
              <article
                key={record.id}
                className="border border-foreground/12 bg-background/50 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {sourceLabels[record.name]}
                    </p>
                    <p className="ji-mono mt-1 text-[10px] text-muted-foreground">
                      {record.reference}
                    </p>
                  </div>
                  <a
                    href={record.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open bronrecord ${record.reference}`}
                    className="grid size-11 shrink-0 place-items-center border border-foreground/12 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                </div>
                <dl className="ji-mono mt-3 grid gap-2 text-[10px] text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <dt>scrape_run_id</dt>
                    <dd className="truncate text-foreground/72">
                      {record.scrapeRunId}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>normalisatie</dt>
                    <dd className="text-foreground/72">
                      {record.normalizationVersion}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>laatst gezien</dt>
                    <dd className="text-foreground/72">
                      {formatDate(record.lastSeenAt)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-foreground/10 px-5 py-5">
          <div className="flex items-center gap-2">
            <FileJson2
              aria-hidden="true"
              className="size-4 text-[var(--ji-signal-strong)] dark:text-[var(--ji-signal)]"
            />
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Raw preview
            </h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Veilige voorbeeldpayload. De volledige immutable bronpayload volgt
            via de U7 read-raw capability.
          </p>
          <pre className="ji-mono mt-3 max-h-72 overflow-auto border border-foreground/12 bg-[var(--ji-ink)] p-3 text-[10px] leading-relaxed text-[var(--ji-paper-muted)]">
            {rawPreview}
          </pre>
        </section>
      </div>

      <div className="border-t border-foreground/10 bg-card p-4">
        <button
          type="button"
          disabled
          title="U7 REST-capability is nog niet beschikbaar"
          className="min-h-11 w-full cursor-not-allowed border border-foreground/12 bg-muted px-4 text-sm font-semibold text-muted-foreground"
        >
          Markeren · API volgt
        </button>
      </div>
    </div>
  );
};
