import { useState } from "react";
import type { WorldState } from "@verdant/protocol";
import { CITY_PLOTS, CITY_VARIANTS, type EvidenceFamily, type EvidenceMilestone, type PlacementRequest } from "@verdant/protocol/city";
import type { EvidenceBuildPlan } from "../game/evidenceCity/placementModel";
import "./evidence-city.css";

const FAMILIES: Array<{ id: EvidenceFamily; title: string; description: string; requirement: string }> = [
  { id: "storage", title: "Energy storage", description: "Reserve policies that protect critical demand.", requirement: "Validate a policy with battery reserve across every holdout, shock and stress cell." },
  { id: "flexibility", title: "Flexible demand", description: "Charging and cooling policies tested together.", requirement: "Validate a policy with EV shifting or precooling, including paired statistical support." },
  { id: "resilience", title: "Resilience research", description: "A permanent record of the complete validation.", requirement: "Meet the planning target with stable independent evidence and no introduced failures." },
];

export function ArchitecturePreview({ variantId }: { variantId: string }) {
  const index = CITY_VARIANTS.findIndex((variant) => variant.id === variantId) % 3;
  return <svg className={`city-architecture architecture-${index}`} viewBox="0 0 180 108" aria-hidden="true">
    <ellipse cx="89" cy="88" rx="65" ry="13" fill="#d5dfcd" />
    <path d="M24 77 88 43 157 77 93 104Z" fill="#dbe9ca" stroke="#a4bb91" />
    <path d={index === 2 ? "M67 83V22L91 10 116 23V83L91 95Z" : "M48 76V41L92 19 135 41V76L92 98Z"} fill="#7c9c77" />
    <path d={index === 2 ? "M67 22 91 10 116 23 91 36Z" : "M48 41 92 19 135 41 92 63Z"} fill="#f1f4e8" />
    <path d={index === 2 ? "M91 36 116 23V83L91 95Z" : "M92 63 135 41V76L92 98Z"} fill="#527c66" />
    {index === 0 && <g fill="#3e666d" stroke="#afcec6" strokeWidth="1.5"><path d="m62 39 29-15 27 14-28 15Z" /><path d="m72 34 27 14m-16-20 27 14m-33 5 28-15" /></g>}
    {index === 1 && <g fill="#b8d8d9"><path d="m57 53 25 13v7L57 60Z" /><path d="m103 63 21-11v8l-21 11Z" /><path d="m103 77 21-11v8l-21 11Z" /></g>}
    {index === 2 && <g stroke="#c8e0c8" strokeWidth="4"><path d="m96 45 14-7m-14 21 14-7m-14 21 14-7m-14 21 14-7" /></g>}
    <path d="M38 80V65m104 23V74" stroke="#897455" strokeWidth="3" /><circle cx="38" cy="63" r="9" fill="#99b969" /><circle cx="144" cy="71" r="8" fill="#6f9f70" />
  </svg>;
}

export function EvidenceCityPanel({ world, busy, buildPlan, error, availablePlotIds, onChoose, onPlanChange, onPlace, onInspect }: {
  world: WorldState | null; busy: boolean; buildPlan: EvidenceBuildPlan | null; error: string | null;
  availablePlotIds: string[];
  onChoose: (milestone: EvidenceMilestone, variantId: string) => void;
  onPlanChange: (plan: EvidenceBuildPlan | null) => void;
  onPlace: (request: PlacementRequest) => void;
  onInspect: (milestoneId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plotId, setPlotId] = useState("");
  const pending = world?.pendingMilestones ?? [];
  const selected = pending.find((milestone) => milestone.id === (buildPlan?.milestoneId ?? selectedId)) ?? pending[0];
  const chosenPlot = availablePlotIds.includes(plotId) ? plotId : availablePlotIds[0] ?? "";
  const variants = selected ? CITY_VARIANTS.filter((variant) => variant.family === selected.family) : [];

  return <section className="evidence-city-panel" aria-label="City master plan">
    <header className="evidence-city-heading"><div><span className="studio-eyebrow">CITY MASTER PLAN</span><h3>Build from the evidence.</h3><p>Validated milestones unlock architecture. Your choices shape its appearance and location.</p></div><span className={`city-pending-count ${pending.length ? "has-pending" : ""}`}>{pending.length ? `${pending.length} ready to place` : "Awaiting validated proof"}</span></header>
    <div className="city-family-grid">
      {FAMILIES.map((family) => {
        const earned = pending.filter((milestone) => milestone.family === family.id);
        const buildings = world?.buildings.filter((building) => building.family === family.id && building.milestoneId) ?? [];
        const level = Math.max(0, ...buildings.map((building) => building.level ?? 1));
        return <article key={family.id} className={`city-family ${earned.length ? "is-unlocked" : ""}`}>
          <div className="city-family-top"><span>{family.id === "storage" ? "01" : family.id === "flexibility" ? "02" : "03"}</span><b>{earned.length ? "Proof earned" : level ? `Level ${level}` : "Locked"}</b></div>
          <h4>{family.title}</h4><p>{family.description}</p>
          <div className="city-levels" aria-label={`Construction level ${level} of 3`}>{[1, 2, 3].map((step) => <i key={step} className={step <= level ? "complete" : ""} />)}</div>
          {earned.length ? <button disabled={busy} onClick={() => { setSelectedId(earned[0].id); onPlanChange(null); }}>Choose architecture <span aria-hidden="true">↗</span></button>
            : buildings.length ? <button disabled={busy} onClick={() => onInspect(buildings[buildings.length - 1].milestoneId!)}>Inspect certificate <span aria-hidden="true">↗</span></button>
            : <p className="city-unlock-requirement"><strong>Unlock requirement</strong>{family.requirement}</p>}
        </article>;
      })}
    </div>
    {selected && <div className="city-construction-picker">
      <div className="city-picker-heading"><div><h4>Choose a design for your level {selected.level} milestone</h4><p>All three designs represent the same {selected.family} proof. Appearance does not change the simulation.</p></div>{pending.length > 1 && <label>Milestone<select aria-label="Earned milestone" value={selected.id} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); onPlanChange(null); }}>{pending.map((item) => <option key={item.id} value={item.id}>{item.family} · level {item.level} · {item.proof.resultRunId.slice(0, 8)}</option>)}</select></label>}</div>
      <div className="city-variant-grid">{variants.map((variant) => <button key={variant.id} className={buildPlan?.milestoneId === selected.id && buildPlan.variantId === variant.id ? "chosen" : ""} aria-pressed={buildPlan?.milestoneId === selected.id && buildPlan.variantId === variant.id} disabled={busy} onClick={() => onChoose(selected, variant.id)}><ArchitecturePreview variantId={variant.id} /><strong>{variant.label}</strong><span>{buildPlan?.variantId === variant.id ? "Selected · choose a plot" : "Select this design"}</span></button>)}</div>
      {buildPlan && <div className="city-placement-controls"><p><strong>Construction preview</strong>Choose a highlighted plot in the city, or use these controls. R rotates the preview; Esc cancels.</p><label>Orientation<select aria-label="Building orientation" disabled={busy} value={buildPlan.rotation} onChange={(event) => onPlanChange({ ...buildPlan, rotation: Number(event.target.value) as EvidenceBuildPlan["rotation"] })}>{[0, 90, 180, 270].map((angle) => <option key={angle} value={angle}>{angle}°</option>)}</select></label><label>Eligible plot<select aria-label="Eligible construction plot" disabled={busy || !availablePlotIds.length} value={chosenPlot} onChange={(event) => setPlotId(event.target.value)}>{availablePlotIds.length ? availablePlotIds.map((id) => <option key={id} value={id}>{CITY_PLOTS.find((plot) => plot.id === id)?.label ?? id}</option>) : <option value="">No eligible plot available</option>}</select></label><button className="city-primary-action" disabled={busy || !chosenPlot} onClick={() => onPlace({ ...buildPlan, plotId: chosenPlot })}>Construct here</button><button disabled={busy} onClick={() => onPlanChange(null)}>Cancel</button></div>}
      <button className="city-proof-link" disabled={busy} onClick={() => onInspect(selected.id)}>Inspect the proof behind this milestone ↗</button>
    </div>}
    {error && <p className="city-action-error" role="alert">{error}</p>}
    <p className="city-evidence-note">Repeated copies of the same evidence do not earn extra buildings. Upgrades require stronger validated evidence. Earlier city scenery remains illustrative.</p>
  </section>;
}
