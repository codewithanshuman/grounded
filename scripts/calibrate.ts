import { runMonteCarlo, LOCATIONS, DEFAULT_CONFIG, DEFAULT_INTERVENTION } from "../packages/sim/src/index.ts";

for (const preset of ["normal", "heatwave", "storm", "evsurge", "extreme"] as const) {
  const mc = runMonteCarlo(1500, LOCATIONS.jaipur, preset, DEFAULT_CONFIG, DEFAULT_INTERVENTION);
  const riskPct = ((mc.counts.high + mc.counts.critical) / mc.n) * 100;
  console.log(preset.padEnd(10), JSON.stringify(mc.counts), `risk=${riskPct.toFixed(1)}%`);
}
