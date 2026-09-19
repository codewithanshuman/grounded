import { useState, type FormEvent } from "react";
import type { SiteDataProfile } from "@verdant/protocol";
import type { CommissionSiteInput } from "../ws/client";

export function SiteCommissionPanel({ onCommission }: { onCommission: (input: CommissionSiteInput) => Promise<SiteDataProfile> }) {
  const [siteName, setSiteName] = useState("Jaipur Community Microgrid");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [pvCapacityKW, setPvCapacityKW] = useState(500);
  const [demandFile, setDemandFile] = useState<File | null>(null);
  const [pvFile, setPvFile] = useState<File | null>(null);
  const [outageFile, setOutageFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "complete" | "error">("idle");
  const [message, setMessage] = useState("Upload three CSV exports. Grounded validates, fingerprints and withholds 20% for an honest out-of-sample check.");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!demandFile || !pvFile || !outageFile) {
      setStatus("error");
      setMessage("Choose demand, PV and outage CSV files before commissioning.");
      return;
    }
    setStatus("working");
    setMessage("Validating interval coverage, restoration history and unseen holdout accuracy…");
    try {
      const profile = await onCommission({
        siteName, timezone, pvCapacityKW,
        demandFileName: demandFile.name, pvFileName: pvFile.name, outageFileName: outageFile.name,
        demandCsv: await demandFile.text(), pvCsv: await pvFile.text(), outageCsv: await outageFile.text(),
      });
      setStatus("complete");
      setMessage(`${profile.label} is active · ${profile.fingerprint} · ${profile.status.replaceAll("_", " ")}`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The data could not be commissioned.");
    }
  };

  return (
    <section className="method-section commissioning-card">
      <div className="method-heading"><span>07</span><div><small>LOCAL COMMISSIONING</small><h4>Turn three exports into a site twin</h4></div><a href="/templates/site-data-contract.md" target="_blank" rel="noreferrer">CSV contract ↗</a></div>
      <div className="commissioning-flow"><span><b>1</b> Demand meter</span><i>→</i><span><b>2</b> PV inverter</span><i>→</i><span><b>3</b> Outage log</span><i>→</i><span><b>✓</b> Fingerprinted twin</span></div>
      <form onSubmit={submit}>
        <div className="commissioning-fields">
          <label><span>Site name</span><input value={siteName} onChange={(event) => setSiteName(event.target.value)} required minLength={2} /></label>
          <label><span>IANA timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label>
          <label><span>Installed PV capacity</span><div><input type="number" value={pvCapacityKW} onChange={(event) => setPvCapacityKW(Number(event.target.value))} min={1} required /><small>kW</small></div></label>
        </div>
        <div className="commissioning-files">
          <label><span>15-minute demand</span><input aria-label="Demand CSV" type="file" accept=".csv,text/csv" onChange={(event) => setDemandFile(event.target.files?.[0] ?? null)} /><small>timestamp, demand_kw</small></label>
          <label><span>15-minute PV</span><input aria-label="PV CSV" type="file" accept=".csv,text/csv" onChange={(event) => setPvFile(event.target.files?.[0] ?? null)} /><small>timestamp, pv_kw</small></label>
          <label><span>Outage/restoration history</span><input aria-label="Outage CSV" type="file" accept=".csv,text/csv" onChange={(event) => setOutageFile(event.target.files?.[0] ?? null)} /><small>outage_started_at, restored_at, cause</small></label>
        </div>
        <div className={`commissioning-submit ${status}`}><p><strong>{status === "complete" ? "Commissioned" : status === "error" ? "Needs attention" : status === "working" ? "Commissioning…" : "Files stay on this Grounded server"}</strong><span>{message}</span></p><button type="submit" disabled={status === "working"}>{status === "working" ? "Validating…" : "Commission site twin →"}</button></div>
      </form>
    </section>
  );
}
