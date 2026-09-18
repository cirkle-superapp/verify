/**
 * Cirkle Metrics Registry — Prometheus-compatible in-memory metrics.
 *
 * Exposes:
 *   - Counters (monotonically increasing values, can be labeled)
 *   - Histograms (bucketed observation distributions)
 *   - Gauges (point-in-time values, can go up or down)
 *
 * State is held in a module-level Map — survives across requests in a
 * single Vercel instance lifecycle (resets on cold start).
 *
 * Prometheus format:
 *   # HELP metric_name description
 *   # TYPE metric_name counter|gauge|histogram
 *   metric_name{label="value"} 42
 *   metric_name_bucket{le="0.1"} 5
 *   metric_name_bucket{le="+Inf"} 10
 *   metric_name_sum 4.2
 *   metric_name_count 10
 *
 * Exported helpers:
 *   - incCounter(name, labels?, by?)      → increment a counter
 *   - observeHistogram(name, value, labels?) → observe a value into buckets
 *   - setGauge(name, value, labels?)      → set a gauge to a value
 *   - renderPrometheus()                  → return Prometheus text format
 *
 * The /api/v1/verify/metrics endpoint calls renderPrometheus() and serves
 * it as text/plain.
 */

type Labels = Record<string, string>;

interface CounterEntry {
  type: "counter";
  name: string;
  help: string;
  value: number;
  labels: Labels;
}

interface GaugeEntry {
  type: "gauge";
  name: string;
  help: string;
  value: number;
  labels: Labels;
}

interface HistogramEntry {
  type: "histogram";
  name: string;
  help: string;
  buckets: number[];            // upper bounds (excluding +Inf which is implicit)
  counts: number[];            // per-bucket cumulative count
  sum: number;
  count: number;
  labels: Labels;
}

type MetricEntry = CounterEntry | GaugeEntry | HistogramEntry;

function labelKey(labels: Labels | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  // Stable sorted key
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
}

function labelString(labels: Labels | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  return (
    "{" +
    Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(",") +
    "}"
  );
}

// Default buckets in seconds — used by latency histograms
const DEFAULT_LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

const registry = new Map<string, MetricEntry>();

function getCounter(name: string, labels: Labels | undefined, help: string): CounterEntry {
  const key = `counter:${name}:${labelKey(labels)}`;
  let entry = registry.get(key) as CounterEntry | undefined;
  if (!entry) {
    entry = {
      type: "counter",
      name,
      help,
      value: 0,
      labels: labels || {},
    };
    registry.set(key, entry);
  }
  return entry;
}

function getGauge(name: string, labels: Labels | undefined, help: string): GaugeEntry {
  const key = `gauge:${name}:${labelKey(labels)}`;
  let entry = registry.get(key) as GaugeEntry | undefined;
  if (!entry) {
    entry = {
      type: "gauge",
      name,
      help,
      value: 0,
      labels: labels || {},
    };
    registry.set(key, entry);
  }
  return entry;
}

function getHistogram(name: string, labels: Labels | undefined, help: string, buckets: number[]): HistogramEntry {
  const key = `histogram:${name}:${labelKey(labels)}`;
  let entry = registry.get(key) as HistogramEntry | undefined;
  if (!entry) {
    entry = {
      type: "histogram",
      name,
      help,
      buckets: [...buckets].sort((a, b) => a - b),
      counts: new Array(buckets.length + 1).fill(0), // last is +Inf
      sum: 0,
      count: 0,
      labels: labels || {},
    };
    registry.set(key, entry);
  }
  return entry;
}

/**
 * Increment a counter by 1 (or `by` if provided).
 */
export function incCounter(name: string, labels?: Labels, by: number = 1): void {
  const entry = getCounter(name, labels, `Counter: ${name}`);
  entry.value += by;
}

/**
 * Observe a value into a histogram's bucket distribution.
 */
export function observeHistogram(name: string, value: number, labels?: Labels, buckets: number[] = DEFAULT_LATENCY_BUCKETS): void {
  const entry = getHistogram(name, labels, `Histogram: ${name}`, buckets);
  entry.sum += value;
  entry.count += 1;
  for (let i = 0; i < entry.buckets.length; i++) {
    if (value <= entry.buckets[i]) {
      entry.counts[i] += 1;
    }
  }
  entry.counts[entry.counts.length - 1] += 1; // +Inf bucket
}

/**
 * Set a gauge to an arbitrary value (can go up or down).
 */
export function setGauge(name: string, value: number, labels?: Labels): void {
  const entry = getGauge(name, labels, `Gauge: ${name}`);
  entry.value = value;
}

/**
 * Render all metrics into Prometheus exposition text format.
 * Suitable for `/api/v1/verify/metrics` to return as text/plain.
 */
export function renderPrometheus(): string {
  const out: string[] = [];
  const seenHelp = new Set<string>();
  const seenType = new Set<string>();

  // Group by metric name to emit HELP/TYPE once per metric
  const grouped = new Map<string, MetricEntry[]>();
  for (const entry of registry.values()) {
    const arr = grouped.get(entry.name) || [];
    arr.push(entry);
    grouped.set(entry.name, arr);
  }

  for (const [name, entries] of grouped.entries()) {
    const first = entries[0];
    if (!seenHelp.has(name)) {
      out.push(`# HELP ${name} ${first.help}`);
      seenHelp.add(name);
    }
    if (!seenType.has(name)) {
      out.push(`# TYPE ${name} ${first.type}`);
      seenType.add(name);
    }
    for (const e of entries) {
      if (e.type === "counter") {
        out.push(`${e.name}${labelString(e.labels)} ${e.value}`);
      } else if (e.type === "gauge") {
        out.push(`${e.name}${labelString(e.labels)} ${e.value}`);
      } else if (e.type === "histogram") {
        // Each bucket is its own labeled sample
        for (let i = 0; i < e.buckets.length; i++) {
          const labels = { ...e.labels, le: String(e.buckets[i]) };
          out.push(`${e.name}_bucket${labelString(labels)} ${e.counts[i]}`);
        }
        out.push(`${e.name}_bucket${labelString({ ...e.labels, le: "+Inf" })} ${e.counts[e.counts.length - 1]}`);
        out.push(`${e.name}_sum${labelString(e.labels)} ${e.sum}`);
        out.push(`${e.name}_count${labelString(e.labels)} ${e.count}`);
      }
    }
  }
  return out.join("\n") + "\n";
}

/**
 * Reset the registry — useful in tests.
 */
export function resetMetrics(): void {
  registry.clear();
}

/**
 * The default latency histogram bucket configuration, exported for tests.
 */
export { DEFAULT_LATENCY_BUCKETS };
