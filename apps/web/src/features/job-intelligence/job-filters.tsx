"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { contractLabels, freshnessLabels } from "./presentation";
import type {
  FacetCount,
  JobContractType,
  JobSearchFacets,
  JobSearchFilters,
  JobSource,
  JobSourceOption,
} from "./types";
import { FRESHNESS_FILTERS } from "./types";

const DEFAULT_VISIBLE_OPTIONS = 6;

const contractOptions: readonly JobContractType[] = [
  "interim",
  "detachering",
  "vast",
  "freelance",
];

const isFreshnessFilter = (
  value: string
): value is JobSearchFilters["freshness"] =>
  FRESHNESS_FILTERS.some((candidate) => candidate === value);

const countActiveFilters = (filters: JobSearchFilters): number =>
  filters.sources.length +
  filters.contractTypes.length +
  filters.locations.length +
  (filters.freshness === "all" ? 0 : 1) +
  (filters.minRate === null ? 0 : 1);

interface FacetGroupProps {
  readonly children: React.ReactNode;
  readonly title: string;
}

const FacetGroup = ({ children, title }: FacetGroupProps) => {
  const [open, setOpen] = useState(true);

  return (
    <fieldset className="border-b border-border py-3 last:border-b-0">
      <legend className="sr-only">{title}</legend>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="flex min-h-9 w-full items-center justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open ? <div className="mt-2 space-y-1.5">{children}</div> : null}
    </fieldset>
  );
};

interface FacetOptionProps<T extends string> {
  readonly checked: boolean;
  readonly count: number;
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly value: T;
}

const FacetOption = <T extends string>({
  checked,
  count,
  label,
  onChange,
  value,
}: FacetOptionProps<T>) => (
  <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs transition-colors hover:text-primary">
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onChange(value)}
      className="size-3.5 shrink-0 accent-[var(--primary)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
      {count}
    </span>
  </label>
);

const ShowAllToggle = ({
  hiddenLabel,
  onToggle,
  showAll,
  total,
}: {
  readonly hiddenLabel: string;
  readonly onToggle: () => void;
  readonly showAll: boolean;
  readonly total: number;
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="min-h-8 text-[11px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
  >
    {showAll
      ? `Toon minder ${hiddenLabel}`
      : `Toon alle ${total} ${hiddenLabel}`}
  </button>
);

const findFacetCount = <T extends string>(
  facets: readonly FacetCount<T>[],
  value: T
): number => facets.find((facet) => facet.value === value)?.count ?? 0;

interface JobFiltersProps {
  readonly facets: JobSearchFacets;
  readonly filters: JobSearchFilters;
  readonly onClear: () => void;
  readonly onContractToggle: (value: JobContractType) => void;
  readonly onFreshnessChange: (value: JobSearchFilters["freshness"]) => void;
  readonly onLocationToggle: (value: string) => void;
  readonly onMinRateChange: (value: number | null) => void;
  readonly onSourceToggle: (value: JobSource) => void;
  readonly sources: readonly JobSourceOption[];
}

export const JobFilters = ({
  facets,
  filters,
  onClear,
  onContractToggle,
  onFreshnessChange,
  onLocationToggle,
  onMinRateChange,
  onSourceToggle,
  sources,
}: JobFiltersProps) => {
  const [showAllSources, setShowAllSources] = useState(false);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const activeCount = countActiveFilters(filters);
  const visibleSources = showAllSources
    ? sources
    : sources.slice(0, DEFAULT_VISIBLE_OPTIONS);
  const visibleLocations = showAllLocations
    ? facets.locations
    : facets.locations.slice(0, DEFAULT_VISIBLE_OPTIONS);

  return (
    <div className="px-4 pb-4 min-[800px]:px-0">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          Filters
          {activeCount > 0 ? (
            <span className="grid size-5 place-items-center rounded-full bg-primary font-mono text-[10px] text-primary-foreground tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="min-h-8 text-[11px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Alles wissen
        </button>
      </div>

      <FacetGroup title="Bron">
        {visibleSources.map((source) => (
          <FacetOption
            key={source.value}
            value={source.value}
            label={source.label}
            count={findFacetCount(facets.sources, source.value)}
            checked={filters.sources.includes(source.value)}
            onChange={onSourceToggle}
          />
        ))}
        {sources.length > DEFAULT_VISIBLE_OPTIONS ? (
          <ShowAllToggle
            hiddenLabel="bronnen"
            onToggle={() => setShowAllSources((previous) => !previous)}
            showAll={showAllSources}
            total={sources.length}
          />
        ) : null}
      </FacetGroup>

      <FacetGroup title="Contract">
        {contractOptions.map((contract) => (
          <FacetOption
            key={contract}
            value={contract}
            label={contractLabels[contract]}
            count={findFacetCount(facets.contractTypes, contract)}
            checked={filters.contractTypes.includes(contract)}
            onChange={onContractToggle}
          />
        ))}
      </FacetGroup>

      <FacetGroup title="Locatie">
        {facets.locations.length === 0 ? (
          <p className="text-xs text-muted-foreground">Geen locaties</p>
        ) : null}
        {visibleLocations.map(({ count, value }) => (
          <FacetOption
            key={value}
            value={value}
            label={value}
            count={count}
            checked={filters.locations.includes(value)}
            onChange={onLocationToggle}
          />
        ))}
        {facets.locations.length > DEFAULT_VISIBLE_OPTIONS ? (
          <ShowAllToggle
            hiddenLabel="locaties"
            onToggle={() => setShowAllLocations((previous) => !previous)}
            showAll={showAllLocations}
            total={facets.locations.length}
          />
        ) : null}
      </FacetGroup>

      <FacetGroup title="Gepubliceerd">
        <label className="sr-only" htmlFor="freshness-filter">
          Filter op publicatiedatum
        </label>
        <select
          id="freshness-filter"
          value={filters.freshness}
          onChange={(event) => {
            const { value } = event.target;
            if (isFreshnessFilter(value)) {
              onFreshnessChange(value);
            }
          }}
          className="min-h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {Object.entries(freshnessLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FacetGroup>

      <FacetGroup title="Minimum uurtarief">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">
            €
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="5"
            value={filters.minRate ?? ""}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              onMinRateChange(Number.isFinite(value) ? value : null);
            }}
            aria-label="Minimum uurtarief"
            placeholder="Geen minimum"
            className="min-h-9 w-full rounded-md border border-input bg-background pr-2 pl-6 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      </FacetGroup>
    </div>
  );
};
