# Live-system city upgrade

## Implemented locally

- Expanded 48 × 36 city with the archive's roads, airport, harbour, courthouse,
  construction crews and scaffold/crane sequence retained.
- Detailed hospital, school, temple, church and Eiffel-inspired observation
  tower built from the archive's isometric masonry primitives.
- Three animated wind turbines, lattice electricity pylons with sagging cables,
  and directional cars/buses using the existing road routing system.
- Larger offshore forest, mixed tree forms, reserve buildings, walking paths
  and a continuous 17-tile bridge across the existing water channel. Mainland
  terrain is not cut away to make the channel.
- Shared building clearances prevent decorative and evidence trees from
  entering reserve structures. Boat rendering stays beneath the bridge deck.
- City, Forest, Bridge, Civic quarter, Energy and Whole world camera views.
  Civic quarter is the church/observation-tower close-up; the other landmarks
  remain in the City view. Views refit when the canvas changes size.
- Scaled facilities keep the correct ground anchor for construction crews.
  Dashboard/HUD wheel events do not intentionally control the city camera.

## Evidence and scope

The new landmarks and ambient energy/traffic animations are illustrative, not
surveyed Jaipur facilities or live telemetry. Evidence trees still link to
completed simulation runs. No simulation, optimizer, data-import or proof
features were removed. The landing page and dashboard styling were not redesigned
in this update.

## Verification

- `pnpm test`: 44 passing tests, including seven layout regression tests for
  road/campus separation, intact mainland, bridge endpoints, open water, tree
  paths and reserve-building clearance.
- `pnpm build:static`: successful, including the web TypeScript check. The
  existing large-bundle and dependency annotation warnings remain non-fatal.
- A local browser run of 500 futures completed and advanced the displayed
  evidence count from four trees to five.
- Bridge, Civic quarter and Energy navigation were activated with keyboard
  controls; the preview reported no browser errors in the inspected log.
- The scene was visually inspected in the in-app browser. Automated viewport
  captures were clipped by the browser panel, so a complete full-screen/mobile
  visual sign-off and a frame-by-frame animation review remain outstanding.

Check the release commit's deployment status and the production site's served
assets to confirm the public release. A successful local build alone is not
evidence that Vercel is serving that release.
