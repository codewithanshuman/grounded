import type { LocationId, MicrogridConfig, PresetId } from "@verdant/protocol";
import { LOCATIONS, PRESETS, PRESET_ORDER } from "@verdant/sim";
import { Field } from "./Widgets";

export function TwinPanel({ config, setConfigField, locationId }: {
  config: MicrogridConfig;
  setConfigField: (key: keyof MicrogridConfig) => (value: number) => void;
  locationId: LocationId;
}) {
  return (
    <div className="config-sections">
      <p className="config-priority">{LOCATIONS[locationId].label} microgrid. Critical hospital demand is served before flexible loads.</p>
      <details className="config-group" open><summary><span><b>01</b>Generation &amp; storage</span><i aria-hidden="true">+</i></summary><div className="config-group-body">
      <Field label="Solar capacity" value={config.solarCapacityKW} onChange={setConfigField("solarCapacityKW")} min={0} step={10} unit="kW" />
      <Field label="Battery capacity" value={config.batteryCapacityKWh} onChange={setConfigField("batteryCapacityKWh")} min={0} step={50} unit="kWh" />
      <Field label="Starting charge" value={config.batteryStartPct} onChange={setConfigField("batteryStartPct")} min={0} max={100} step={1} unit="%" />
      </div></details>
      <details className="config-group"><summary><span><b>02</b>Battery physics</span><i aria-hidden="true">+</i></summary><div className="config-group-body">
      <Field label="Max charge" value={config.batteryMaxChargeKW} onChange={setConfigField("batteryMaxChargeKW")} min={0} step={25} unit="kW" />
      <Field label="Max discharge" value={config.batteryMaxDischargeKW} onChange={setConfigField("batteryMaxDischargeKW")} min={0} step={25} unit="kW" />
      <Field label="Round-trip efficiency" value={config.batteryRoundTripEfficiencyPct} onChange={setConfigField("batteryRoundTripEfficiencyPct")} min={50} max={100} step={1} unit="%" />
      <Field label="Minimum safe charge" value={config.batteryMinSocPct} onChange={setConfigField("batteryMinSocPct")} min={0} max={40} step={1} unit="%" />
      </div></details>
      <details className="config-group" open><summary><span><b>03</b>Demand &amp; critical loads</span><i aria-hidden="true">+</i></summary><div className="config-group-body">
      <Field label="Hospital (critical)" value={config.hospitalKW} onChange={setConfigField("hospitalKW")} min={0} step={10} unit="kW" />
      <Field label="Homes" value={config.homesCount} onChange={setConfigField("homesCount")} min={0} step={1} unit="count" />
      <Field label="Avg. home draw" value={config.avgHomeKW} onChange={setConfigField("avgHomeKW")} min={0} step={0.1} unit="kW" />
      <Field label="EV chargers" value={config.evCount} onChange={setConfigField("evCount")} min={0} step={1} unit="count" />
      <Field label="EV charger power" value={config.evChargerKW} onChange={setConfigField("evChargerKW")} min={0} step={0.5} unit="kW" />
      </div></details>
      <details className="config-group"><summary><span><b>04</b>Grid &amp; restoration</span><i aria-hidden="true">+</i></summary><div className="config-group-body">
      <Field label="Max import" value={config.gridMaxImportKW} onChange={setConfigField("gridMaxImportKW")} min={0} step={10} unit="kW" />
      <Field label="Mean restoration" value={config.gridRestorationMeanHours} onChange={setConfigField("gridRestorationMeanHours")} min={0.25} max={72} step={0.25} unit="hr" />
      </div></details>
      <details className="config-group"><summary><span><b>05</b>Cost &amp; carbon</span><i aria-hidden="true">+</i></summary><div className="config-group-body">
      <Field label="Grid energy cost" value={config.gridEnergyCostPerKWh} onChange={setConfigField("gridEnergyCostPerKWh")} min={0} step={0.01} unit="$/kWh" />
      <Field label="Battery wear cost" value={config.batteryDegradationCostPerKWh} onChange={setConfigField("batteryDegradationCostPerKWh")} min={0} step={0.005} unit="$/kWh" />
      <Field label="Grid carbon" value={config.gridCarbonKgPerKWh} onChange={setConfigField("gridCarbonKgPerKWh")} min={0} step={0.01} unit="kg/kWh" />
      </div></details>
    </div>
  );
}

export function StressPanel({ preset, setPreset, isSweeping, runClimateSweep, disabled = false }: {
  preset: PresetId;
  setPreset: (preset: PresetId) => void;
  isSweeping: boolean;
  runClimateSweep: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="w-72 space-y-2">
      <p className="text-[11px] text-slate-500 mb-1">Pick the weather regime to test, then run the calibrated evidence population.</p>
      {PRESET_ORDER.map((id, index) => <button key={id} onClick={() => setPreset(id)} aria-pressed={preset === id} className={`scenario-card ${preset === id ? "active" : ""}`}><span className="hazard-number" aria-hidden="true">0{index + 1}</span><span><span className="hazard-title">{PRESETS[id].label}</span><span className="hazard-description">{PRESETS[id].blurb}</span></span><i className="hazard-choice" aria-hidden="true" /></button>)}
      <button onClick={runClimateSweep} disabled={disabled || isSweeping} className="matrix-action">{isSweeping ? "Running 2,500 futures…" : "Compare all five hazards"}</button>
      <p className="matrix-sample-note">500 shared seeds per hazard · 2,500 futures total</p>
    </div>
  );
}
