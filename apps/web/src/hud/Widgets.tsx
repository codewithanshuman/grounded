import type { RiskBucket } from "@verdant/protocol";
import type { NarrativeEvent } from "@verdant/sim";
import { fmtHour } from "@verdant/sim";
import { useId } from "react";

export const BUCKET_META: Record<RiskBucket, { label: string; color: string }> = {
  safe: { label: "SAFE", color: "#34d399" },
  moderate: { label: "MODERATE", color: "#fbbf24" },
  high: { label: "HIGH RISK", color: "#fb923c" },
  critical: { label: "CRITICAL", color: "#f87171" },
};

export function Field({
  label, value, onChange, min, max, step, unit,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  const id = useId();
  const invalid = !Number.isFinite(value) || (min != null && value < min) || (max != null && value > max);
  return (
    <div className="data-field">
      <label className="data-field-label" htmlFor={id}>{label}</label>
      <div className="data-field-control">
        <input
          type="number"
          id={id}
          value={Number.isFinite(value) ? value : ""}
          min={min} max={max} step={step}
          aria-invalid={invalid || undefined}
          aria-describedby={unit ? `${id}-unit` : undefined}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className="data-field-input"
        />
        {unit && <span id={`${id}-unit`} className="data-field-unit">{unit}</span>}
      </div>
    </div>
  );
}

export function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="stat-block">
      <div className="stat-block-label">{label}</div>
      <div className="stat-block-value" style={{ color: color || "#2f5232" }}>{value}</div>
      {sub && <div className="stat-block-sub">{sub}</div>}
    </div>
  );
}

export function RiskSegmentBar({ counts, total }: { counts: Record<RiskBucket, number>; total: number }) {
  const order: RiskBucket[] = ["safe", "moderate", "high", "critical"];
  return (
    <div>
      <div className="risk-spectrum">
        {order.map((k) => {
          const pct = total ? (counts[k] / total) * 100 : 0;
          if (pct <= 0) return null;
          return <div key={k} className="risk-spectrum-segment" style={{ width: `${pct}%`, backgroundColor: BUCKET_META[k].color }} title={`${BUCKET_META[k].label}: ${counts[k]}`} />;
        })}
      </div>
      <div className="risk-legend">
        {order.map((k) => (
          <div key={k} className="risk-legend-item">
            <div className="risk-legend-label" style={{ color: BUCKET_META[k].color }}>{BUCKET_META[k].label}</div>
            <div className="risk-legend-value">{counts[k].toLocaleString()}</div>
            <div className="risk-legend-pct">{total ? ((counts[k] / total) * 100).toFixed(1) : "0.0"}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineList({ events, failed }: { events: NarrativeEvent[]; failed: boolean }) {
  return (
    <ol className="timeline-list">
      {events.map((e, i) => {
        const isFail = i === events.length - 1 && failed;
        return (
          <li key={i} className={isFail ? "timeline-event failed" : "timeline-event"}>
            <div className="timeline-dot" />
            <div className="timeline-event-row">
              <span className="timeline-time">{fmtHour(e.hour)}</span>
              <span className="timeline-label">{e.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
