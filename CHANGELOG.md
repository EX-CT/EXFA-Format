# Changelog

## 1.1.0 — next-stage compute media

- Add `exfa/compute@1` request envelopes (`computeRequest`), `exfa/group@1` documents (`newGroup`, `compileGroup` lowering to `batch.fits` with `project`/`command` relations and per-item `select`), and `exfa/package@1` exchange packages (`packageFit`, `packageGroup`, `mergePackage`) plus the `exfa/workspace@1` type.
- Fit documents accept optional `id` on modules/drones/fighters/cargo; `resolve` passes them through to emitted FitSpecs so engines can apply projected-fit `select` whitelists.
- Libraries gain a `groups` map (required, `{}` default); the library index carries it and each group also serializes to `groups/<id>.json`.

## 1.0.0 — 2026-10-06

- Define versioned fit documents, libraries, scenarios, and the shared directory layout.
- Add deterministic request resolution, alternatives and branches, history, and legacy library migration.
- Publish the TypeScript package and Rust crate with shared JSON fixtures.
