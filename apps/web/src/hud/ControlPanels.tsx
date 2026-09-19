import type { LocationId, MicrogridConfig, PresetId } from "@verdant/protocol";
import { LOCATIONS, PRESETS, PRESET_ORDER } from "@verdant/sim";
import { Field } from "./Widgets";

export function TwinPanel({ config, setConfigField, locationId }: {
  config: MicrogridConfig;
  setConfigField: (key: keyof MicrogridConfig) => (value: number) => void;
  locationId: LocationId;
}) {
  return (
    <div className="w-72">
      <p className="text-[11px] text-slate-500 mb-2">{LOCATIONS[locationId].label} microgrid. Solar charges the battery; the hospital always claims solar, then grid, then battery first.</p>
      <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1 mt-3">Solar &amp; battery</h3>
      <Field label="Solar capacity" value={config.solarCapacityKW} onChange={setConfigField("solarCapacityKW")} min={0} step={10} unit="kW" />
      <Field label="Battery capacity" value={config.batteryCapacityKWh} onChange={setConfigField("batteryCapacityKWh")} min={0} step={50} unit="kWh" />
      <Field label="Starting charge" value={config.batteryStartPct} onChange={setConfigField("batteryStartPct")} min={0} max={100} step={1} unit="%" />
      <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1 mt-3">Battery physics</h3>
      <Field label="Max charge" value={config.batteryMaxChargeKW} onChange={setConfigField("batteryMaxChargeKW")} min={0} step={25} unit="kW" />
      <Field label="Max discharge" value={config.batteryMaxDischargeKW} onChange={setConfigField("batteryMaxDischargeKW")} min={0} step={25} unit="kW" />
      <Field label="Round-trip efficiency" value={config.batteryRoundTripEfficiencyPct} onChange={setConfigField("batteryRoundTripEfficiencyPct")} min={50} max={100} step={1} unit="%" />
      <Field label="Minimum safe charge" value={config.batteryMinSocPct} onChange={setConfigField("batteryMinSocPct")} min={0} max={40} step={1} unit="%" />
      <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1 mt-3">Loads</h3>
      <Field label="Hospital (critical)" value={config.hospitalKW} onChange={setConfigField("hospitalKW")} min={0} step={10} unit="kW" />
      <Field label="Homes" value={config.homesCount} onChange={setConfigField("homesCount")} min={0} step={10} unit="ct" />
      <Field label="Avg. home draw" value={config.avgHomeKW} onChange={setConfigField("avgHomeKW")} min={0} step={0.1} unit="kW" />
      <Field label="EV chargers" value={config.evCount} onChange={setConfigField("evCount")} min={0} step={5} unit="ct" />
      <Field label="EV charger power" value={config.evChargerKW} onChange={setConfigField("evChargerKW")} min={0} step={0.5} unit="kW" />
      <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1 mt-3">Grid</h3>
      <Field label="Max import" value={config.gridMaxImportKW} onChange={setConfigField("gridMaxImportKW")} min={0} step={10} unit="kW" />
      <Field label="Mean restoration" value={config.gridRestorationMeanHours} onChange={setConfigField("gridRestorationMeanHours")} min={0.25} max={72} step={0.25} unit="hr" />
      <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1 mt-3">Impact accounting</h3>
      <Field label="Grid energy cost" value={config.gridEnergyCostPerKWh} onChange={setConfigField("gridEnergyCostPerKWh")} min={0} step={0.01} unit="$/kWh" />
      <Field label="Battery wear cost" value={config.batteryDegradationCostPerKWh} onChange={setConfigField("batteryDegradationCostPerKWh")} min={0} step={0.005} unit="$/kWh" />
      <Field label="Grid carbon" value={config.gridCarbonKgPerKWh} onChange={setConfigField("gridCarbonKgPerKWh")} min={0} step={0.01} unit="kg/kWh" />
    </div>
  );
}

export function StressPanel({ preset, setPreset, isSweeping, runClimateSweep }: {
  preset: PresetId;
  setPreset: (preset: PresetId) => void;
  isSweeping: boolean;
  runClimateSweep: () => void;
}) {
  return (
    <div className="w-72 space-y-2">
      <p className="text-[11px] text-slate-500 mb-1">Pick the weather regime to test, then run the calibrated evidence population.</p>
      {PRESET_ORDER.map((id) => <button key={id} onClick={() => setPreset(id)} className={`scenario-card ${preset === id ? "active" : ""}`}><div className="text-[12px] font-medium text-slate-200">{PRESETS[id].label}</div><div className="text-[10px] text-slate-500 mt-0.5">{PRESETS[id].blurb}</div></button>)}
      <button onClick={runClimateSweep} disabled={isSweeping} className="matrix-action">{isSweeping ? "Running 2,500 futures…" : "Run all-hazard climate matrix"}</button>
    </div>
  );
}
