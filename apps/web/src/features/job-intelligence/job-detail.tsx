import { ExternalLink, X } from "lucide-react";

import { JobBodyContent } from "./job-body-content";
import {
  formatContract,
  formatDate,
  formatRate,
  formatRemote,
  isFieldAangevuld,
  sourceLabel,
} from "./presentation";
import type { JobListing, JobMarkering, MarkeringSyncState } from "./types";

const RAW_PREVIEW_INDENT = 2;

const badgeClass =
  "rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-medium";

const DetailField = ({
  aangevuld = false,
  label,
  value,
}: {
  readonly aangevuld?: boolean;
  readonly label: string;
  readonly value: string;
}) => (
  <div>
    <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
      {label}
    </dt>
    <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs break-words">
      <span>{value}</span>
      {aangevuld ? (
        <span className="rounded-full border border-chart-2/40 bg-chart-2/10 px-2 py-0.5 text-[10px] font-medium text-chart-2">
          aangevuld
        </span>
      ) : null}
    </dd>
  </div>
);

const DetailSection = ({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) => (
  <div>
    <h3 className="mb-2 font-display text-sm font-semibold">{title}</h3>
    {children}
  </div>
);

const ProvenanceCard = ({
  record,
}: {
  readonly record: JobListing["sourceRecords"][number];
}) => (
  <article className="rounded-lg border border-border bg-background/60 p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">{sourceLabel(record.name)}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {record.reference}
        </p>
      </div>
      <a
        href={record.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open bronrecord ${record.reference}`}
        className="grid size-9 shrink-0 place-items-center rounded-md border border-input text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
    </div>
    <dl className="mt-3 grid gap-1.5 font-mono text-[10px] text-muted-foreground">
      <div className="flex justify-between gap-3">
        <dt>bron</dt>
        <dd className="text-foreground/80">{sourceLabel(record.name)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>bron_referentie</dt>
        <dd className="truncate text-foreground/80">{record.reference}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>scrape_run_id</dt>
        <dd className="truncate text-foreground/80">{record.scrapeRunId}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>normalisatieversie</dt>
        <dd className="text-foreground/80">{record.normalizationVersion}</dd>
      </div>
      {record.lastSeenAt ? (
        <div className="flex justify-between gap-3">
          <dt>laatst gezien</dt>
          <dd className="text-foreground/80">
            {formatDate(record.lastSeenAt)}
          </dd>
        </div>
      ) : null}
      {record.validFrom ? (
        <div className="flex justify-between gap-3">
          <dt>versie geldig vanaf</dt>
          <dd className="text-foreground/80">{formatDate(record.validFrom)}</dd>
        </div>
      ) : null}
      {record.validTo ? (
        <div className="flex justify-between gap-3">
          <dt>versie geldig tot</dt>
          <dd className="text-foreground/80">{formatDate(record.validTo)}</dd>
        </div>
      ) : null}
    </dl>
  </article>
);

interface JobDetailProps {
  readonly descriptionId: string;
  readonly job: JobListing;
  readonly isMarkeringMutationPending?: boolean;
  readonly liveData?: boolean;
  readonly markering?: JobMarkering | null;
  readonly markeringSyncState?: MarkeringSyncState;
  readonly onClose: () => void;
  readonly onMarkeer?: () => void;
  readonly titleId: string;
}

const markeringActionLabel = (
  markering: JobMarkering | null,
  isPending: boolean
): string => {
  if (isPending) {
    return "Markering opslaan…";
  }
  return markering ? "Opnieuw markeren als relevant" : "Markeren als relevant";
};

const markeringActionTitle = (
  isPending: boolean,
  isAvailable: boolean
): string => {
  if (isPending) {
    return "Markering wordt opgeslagen";
  }
  return isAvailable
    ? "Markeer als relevant"
    : "Markeren vereist de U7 REST-capability";
};

export const JobDetail = ({
  descriptionId,
  job,
  isMarkeringMutationPending = false,
  liveData = false,
  markering = null,
  markeringSyncState = "idle",
  onClose,
  onMarkeer,
  titleId,
}: JobDetailProps) => {
  const rawPreview =
    job.rawPreview ??
    JSON.stringify(
      {
        contract_type: job.contractType,
        description: job.description,
        location: job.location,
        organization: job.organization,
        skills: job.skills,
        title: job.title,
      },
      null,
      RAW_PREVIEW_INDENT
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4">
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="font-display text-lg leading-snug font-semibold tracking-tight"
          >
            {job.title}
          </h2>
          <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
            {job.organization ?? "Onbekend"} · {job.location ?? "Onbekend"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className={`${badgeClass} border-primary/40 text-primary`}>
              {formatContract(job)}
            </span>
            {job.status === "closing-soon" ? (
              <span className={`${badgeClass} border-chart-2/40 text-chart-2`}>
                Sluit binnenkort
              </span>
            ) : null}
            <span className={badgeClass}>{formatRemote(job)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Vacaturedetail sluiten"
          className="grid size-9 shrink-0 place-items-center rounded-md border border-input text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <DetailField
            label="Organisatie"
            value={job.organization ?? "Onbekend"}
          />
          <DetailField
            label="Locatie"
            value={job.location ?? "Onbekend"}
            aangevuld={isFieldAangevuld(job, "locatie")}
          />
          <DetailField
            label="Tarief"
            value={formatRate(job)}
            aangevuld={isFieldAangevuld(job, "tarief")}
          />
          <DetailField
            label="Contract"
            value={formatContract(job)}
            aangevuld={isFieldAangevuld(job, "contract")}
          />
          <DetailField
            label="Gepubliceerd"
            value={formatDate(job.publishedAt)}
          />
          <DetailField label="Sluit" value={formatDate(job.closingAt)} />
        </dl>

        <DetailSection title="Opdracht">
          <JobBodyContent
            bronSlug={job.sourceRecords[0]?.name}
            content={job.summary}
            className="text-foreground"
          />
          {job.description.trim() &&
          job.description.trim() !== job.summary.trim() ? (
            <JobBodyContent
              bronSlug={job.sourceRecords[0]?.name}
              content={job.description}
              className="mt-2 text-muted-foreground"
            />
          ) : null}
        </DetailSection>

        {job.skills.length > 0 ? (
          <DetailSection title="Skills">
            <div className="flex flex-wrap gap-1.5">
              {job.skills.map((skill) => (
                <span key={skill} className={badgeClass}>
                  {skill}
                </span>
              ))}
            </div>
          </DetailSection>
        ) : null}

        <DetailSection title="Herkomst">
          <div className="space-y-2.5">
            {job.sourceRecords.map((record) => (
              <ProvenanceCard key={record.id} record={record} />
            ))}
          </div>
        </DetailSection>

        <DetailSection title="Raw preview">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {liveData
              ? "Immutable bronpayload via read_raw (preview)."
              : "Veilige voorbeeldpayload. De volledige immutable bronpayload volgt via de U7 read-raw capability."}
          </p>
          <div
            className="mt-2 min-h-0 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border bg-[var(--ji-ink)]"
            data-testid="job-raw-preview-scroll"
          >
            <pre className="min-h-0 whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-relaxed text-[var(--ji-paper-muted)]">
              {rawPreview}
            </pre>
          </div>
        </DetailSection>
      </div>

      <div className="border-t border-border bg-card p-3">
        {markeringSyncState === "idle" ? null : (
          <p className="mb-2 text-[11px] text-muted-foreground" role="status">
            Synchronisatie: {markeringSyncState}
          </p>
        )}
        {markering ? (
          <p className="mb-2 text-[11px] text-muted-foreground">
            Markering:{" "}
            <span className="font-medium text-foreground">
              {markering.status.replaceAll("_", " ")}
            </span>
          </p>
        ) : null}
        <button
          type="button"
          disabled={!onMarkeer || isMarkeringMutationPending}
          onClick={onMarkeer}
          title={markeringActionTitle(
            isMarkeringMutationPending,
            Boolean(onMarkeer)
          )}
          className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {markeringActionLabel(markering, isMarkeringMutationPending)}
        </button>
      </div>
    </div>
  );
};
