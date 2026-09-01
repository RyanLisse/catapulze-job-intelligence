"use client";

import { X } from "lucide-react";

import { contractLabels, freshnessLabels, sourceLabel } from "./presentation";
import type {
  FreshnessFilter,
  JobContractType,
  JobSearchFilters,
  JobSource,
  JobSourceOption,
} from "./types";

interface ActiveChip {
  readonly key: string;
  readonly onRemove: () => void;
  readonly removeLabel: string;
  readonly text: string;
}

interface JobActiveFiltersProps {
  readonly filters: JobSearchFilters;
  readonly onClearAll: () => void;
  readonly onContractToggle: (value: JobContractType) => void;
  readonly onFreshnessChange: (value: FreshnessFilter) => void;
  readonly onLocationToggle: (value: string) => void;
  readonly onMinRateChange: (value: number | null) => void;
  readonly onQueryClear: () => void;
  readonly onSourceToggle: (value: JobSource) => void;
  readonly query: string;
  readonly sources: readonly JobSourceOption[];
}

const buildChips = ({
  filters,
  onContractToggle,
  onFreshnessChange,
  onLocationToggle,
  onMinRateChange,
  onQueryClear,
  onSourceToggle,
  query,
  sources,
}: Omit<JobActiveFiltersProps, "onClearAll">): readonly ActiveChip[] => {
  const chips: ActiveChip[] = [];

  if (query.trim()) {
    chips.push({
      key: `query:${query}`,
      onRemove: onQueryClear,
      removeLabel: `Zoekterm ${query} verwijderen`,
      text: `“${query}”`,
    });
  }

  for (const source of filters.sources) {
    const label =
      sources.find((option) => option.value === source)?.label ??
      sourceLabel(source);
    chips.push({
      key: `source:${source}`,
      onRemove: () => onSourceToggle(source),
      removeLabel: `Bron ${label} verwijderen`,
      text: label,
    });
  }

  for (const contract of filters.contractTypes) {
    chips.push({
      key: `contract:${contract}`,
      onRemove: () => onContractToggle(contract),
      removeLabel: `Contract ${contractLabels[contract]} verwijderen`,
      text: contractLabels[contract],
    });
  }

  for (const location of filters.locations) {
    chips.push({
      key: `location:${location}`,
      onRemove: () => onLocationToggle(location),
      removeLabel: `Locatie ${location} verwijderen`,
      text: location,
    });
  }

  if (filters.freshness !== "all") {
    chips.push({
      key: `freshness:${filters.freshness}`,
      onRemove: () => onFreshnessChange("all"),
      removeLabel: `Publicatiefilter ${freshnessLabels[filters.freshness]} verwijderen`,
      text: freshnessLabels[filters.freshness],
    });
  }

  if (filters.minRate !== null) {
    chips.push({
      key: `min-rate:${filters.minRate}`,
      onRemove: () => onMinRateChange(null),
      removeLabel: "Minimumtarief verwijderen",
      text: `vanaf €${filters.minRate}`,
    });
  }

  return chips;
};

export const JobActiveFilters = (props: JobActiveFiltersProps) => {
  const { onClearAll, ...chipProps } = props;
  const chips = buildChips(chipProps);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ key, onRemove, removeLabel, text }) => (
        <button
          key={key}
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 text-[11px] outline-none transition-colors hover:border-destructive/60 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text}
          <X aria-hidden="true" className="size-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-8 rounded-full px-2 text-[11px] text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        Alles wissen
      </button>
    </div>
  );
};
