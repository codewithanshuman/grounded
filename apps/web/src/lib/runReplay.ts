import type { RunSummary } from "@verdant/protocol";
import { LOCATIONS, locationFromCalibration, locationWithSiteData } from "@verdant/sim";

/** Replay must use the recorded operational profile as well as the climate. */
export function replayLocation(run: RunSummary) {
  return locationFromCalibration(locationWithSiteData(LOCATIONS[run.location], run.siteData), run.calibration);
}
