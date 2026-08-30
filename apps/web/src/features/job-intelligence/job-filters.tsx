"use client";

import { RotateCcw } from "lucide-react";

import { contractLabels, freshnessLabels, sourceLabels } from "./presentation";
import type {
  FacetCount,
  JobContractType,
  JobSearchFacets,
  JobSearchFilters,
  JobSource,
} from "./types";
import { FRESHNESS_FILTERS } from "./types";

const sourceOptions: readonly JobSource[] = [
  "inhuurdesk",
  "tenderned",
  "werkenvoor",
  "indeed",
];

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

interface FilterCheckboxProps<T extends string> {
  readonly checked: boolean;
  readonly count: number;
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly value: T;
}

const FilterCheckbox = <T extends string>({
  checked,
  count,
  label,
  onChange,
  value,
}: FilterCheckboxProps<T>) => (
  <label className="group flex min-h-11 cursor-pointer items-center gap-3 text-sm">
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onChange(value)}
      className="size-4 shrink-0 accent-[var(--ji-signal-strong)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
    <span className="min-w-0 flex-1 truncate text-foreground/78 transition-colors group-hover:text-foreground">
      {label}
    </span>
    <span className="ji-mono text-[10px] text-muted-foreground tabular-nums">
      {count}
    </span>
  </label>
);

interface FilterGroupProps {
  readonly children: React.ReactNode;
  readonly legend: string;
}

const FilterGroup = ({ children, legend }: FilterGroupProps) => (
  <fieldset className="border-b border-foreground/10 px-4 py-4 last:border-b-0">
    <legend className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
      {legend}
    </legend>
    {children}
  </fieldset>
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
}: JobFiltersProps) => {
  const visibleLocations = facets.locations.slice(0, 7);

  return (
    <div>
      <div className="flex min-h-12 items-center justify-between border-b border-foreground/10 px-4">
        <h2 className="text-sm font-semibold">Filters</h2>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Wissen
        </button>
      </div>

      <FilterGroup legend="Bron">
        {sourceOptions.map((source) => (
          <FilterCheckbox
            key={source}
            value={source}
            label={sourceLabels[source]}
            count={findFacetCount(facets.sources, source)}
            checked={filters.sources.includes(source)}
            onChange={onSourceToggle}
          />
        ))}
      </FilterGroup>

      <FilterGroup legend="Contract">
        {contractOptions.map((contract) => (
          <FilterCheckbox
            key={contract}
            value={contract}
            label={contractLabels[contract]}
            count={findFacetCount(facets.contractTypes, contract)}
            checked={filters.contractTypes.includes(contract)}
            onChange={onContractToggle}
          />
        ))}
      </FilterGroup>

      <FilterGroup legend="Locatie">
        {visibleLocations.map(({ count, value }) => (
          <FilterCheckbox
            key={value}
            value={value}
            label={value}
            count={count}
            checked={filters.locations.includes(value)}
            onChange={onLocationToggle}
          />
        ))}
      </FilterGroup>

      <FilterGroup legend="Gepubliceerd">
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
          className="min-h-11 w-full border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {Object.entries(freshnessLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FilterGroup>

      <FilterGroup legend="Minimum uurtarief">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
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
            className="min-h-11 w-full border border-input bg-background pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
      </FilterGroup>
    </div>
  );
};
