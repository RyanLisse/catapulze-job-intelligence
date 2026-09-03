"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * `typedRoutes` types router.push against the literal route union, which a
 * URL assembled at runtime can never satisfy. Naming the parameter type here
 * keeps the single unavoidable assertion below narrow and local.
 */
type RouterPushTarget = Parameters<ReturnType<typeof useRouter>["push"]>[0];

const VOLUME_CHART_HEIGHT = 240;
/**
 * Bar charts size to their data instead of stretching a fixed height: with
 * four bronnen a 260px box turns each bar into a 60px slab, which reads as a
 * different chart type than the same component drawing ten locations.
 */
const BAR_THICKNESS = 18;
const BAR_BAND_HEIGHT = 34;
const BARS_CHART_PADDING = 20;
const BARS_CHART_MIN_HEIGHT = 140;
const BARS_CHART_MAX_HEIGHT = 320;
const HISTOGRAM_HEIGHT = 220;
const TOOLTIP_RADIUS = 6;
const AXIS_FONT_SIZE = 11;
const BAR_RADIUS = 3;
const CATEGORY_AXIS_WIDTH = 150;
const VALUE_AXIS_WIDTH = 40;

const tooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: `${TOOLTIP_RADIUS}px`,
  color: "var(--popover-foreground)",
  fontSize: "12px",
} as const;

const axis = {
  axisLine: false,
  fontSize: AXIS_FONT_SIZE,
  stroke: "var(--muted-foreground)",
  tickLine: false,
} as const;

const weekLabelFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "short",
});

export interface WeekPoint {
  readonly count: number;
  readonly week: string;
}

export interface BarPoint {
  readonly href?: string;
  readonly name: string;
  readonly value: number;
}

export interface RateBucket {
  readonly bucket: number;
  readonly count: number;
}

export const WeeklyVolumeChart = ({
  data,
}: {
  readonly data: readonly WeekPoint[];
}) => {
  const formatted = useMemo(
    () =>
      data.map(({ count, week }) => ({
        count,
        label: weekLabelFormatter.format(new Date(week)),
      })),
    [data]
  );

  return (
    <ResponsiveContainer width="100%" height={VOLUME_CHART_HEIGHT}>
      <AreaChart
        data={formatted}
        margin={{ bottom: 0, left: -18, right: 4, top: 4 }}
      >
        <defs>
          <linearGradient id="ji-volume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis dataKey="label" {...axis} minTickGap={16} />
        <YAxis {...axis} width={VALUE_AXIS_WIDTH} allowDecimals={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: "var(--border)" }}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="Opdrachten"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#ji-volume)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export const HorizontalBars = ({
  data,
  linkListLabel,
}: {
  readonly data: readonly BarPoint[];
  /** Names the keyboard-reachable link list that mirrors the clickable bars. */
  readonly linkListLabel: string;
}) => {
  const router = useRouter();
  const height = Math.min(
    BARS_CHART_MAX_HEIGHT,
    Math.max(
      BARS_CHART_MIN_HEIGHT,
      data.length * BAR_BAND_HEIGHT + BARS_CHART_PADDING
    )
  );
  const hrefByName = new Map(
    data
      .filter((point): point is BarPoint & { href: string } =>
        Boolean(point.href)
      )
      .map((point) => [point.name, point.href])
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={[...data]}
          layout="vertical"
          margin={{ bottom: 0, left: 8, right: 16, top: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            horizontal={false}
          />
          <XAxis type="number" {...axis} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            {...axis}
            width={CATEGORY_AXIS_WIDTH}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "var(--accent)", opacity: 0.4 }}
          />
          <Bar
            dataKey="value"
            name="Opdrachten"
            barSize={BAR_THICKNESS}
            radius={[0, BAR_RADIUS, BAR_RADIUS, 0]}
            cursor={hrefByName.size > 0 ? "pointer" : undefined}
            onClick={(entry: { name?: string }) => {
              const href = entry.name ? hrefByName.get(entry.name) : undefined;
              if (href) {
                // SAFETY: every href in this map is built in this app as the
                // literal /jobs route plus one encodeURIComponent'd filter
                // value, so it is always a valid internal route.
                router.push(href as RouterPushTarget);
              }
            }}
          >
            {data.map(({ name }, index) => (
              <Cell
                key={name}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/*
        Recharts bars are SVG shapes: clickable, never focusable. This list
        gives keyboard and screen-reader users the same jump into /jobs that
        a mouse user gets from a bar, without duplicating anything visually.
      */}
      {hrefByName.size > 0 ? (
        <ul className="sr-only" aria-label={linkListLabel}>
          {data.map(({ href, name, value }) =>
            href ? (
              <li key={name}>
                <a href={href}>
                  {name}: {value} opdrachten
                </a>
              </li>
            ) : null
          )}
        </ul>
      ) : null}
    </div>
  );
};

export const RateHistogram = ({
  data,
}: {
  readonly data: readonly RateBucket[];
}) => {
  const formatted = data.map(({ bucket, count }) => ({
    count,
    label: `€${bucket}`,
  }));

  return (
    <ResponsiveContainer width="100%" height={HISTOGRAM_HEIGHT}>
      <BarChart
        data={formatted}
        margin={{ bottom: 0, left: -18, right: 4, top: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis dataKey="label" {...axis} minTickGap={8} />
        <YAxis {...axis} width={VALUE_AXIS_WIDTH} allowDecimals={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
        />
        <Bar
          dataKey="count"
          name="Opdrachten"
          fill="var(--chart-2)"
          radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};
