# Changelog

## 1.2.0 — remove the compute envelope

- Remove the `exfa/compute@1` / `exfa/compute-result@1` envelope: the `computeRequest` / `compute_request` helpers, the `Compute*` TypeScript types and `schema/compute.schema.json`. The engine no longer has a `compute` entry; use `resolve` (a fully resolved FitRequest) with the engine's `calc`, or `batch`.
- `compileGroup` now returns a plain engine BatchRequest, `{ batch_version: 1, fits: [{ id, label, fit }] }`, instead of an envelope-wrapped one (**breaking**: read `request.fits`, not `request.batch.fits`).
- Shorthand defaults (skill presets, module states) are a Format concern; they are not part of this release.

## 1.1.0 — next-stage compute media

- Add `exfa/compute@1` request envelopes (`computeRequest`), `exfa/group@1` documents (`newGroup`, `compileGroup` lowering to `batch.fits` with `project`/`command` relations and per-item `select`), and `exfa/package@1` exchange packages (`packageFit`, `packageGroup`, `mergePackage`) plus the `exfa/workspace@1` type.
- Fit documents accept optional `id` on modules/drones/fighters/cargo; `resolve` passes them through to emitted FitSpecs so engines can apply projected-fit `select` whitelists.
- Libraries gain a `groups` map (required, `{}` default); the library index carries it and each group also serializes to `groups/<id>.json`.

## 1.0.0 — 2026-10-06

- Define versioned fit documents, libraries, scenarios, and the shared directory layout.
- Add deterministic request resolution, alternatives and branches, history, and legacy library migration.
- Publish the TypeScript package and Rust crate with shared JSON fixtures.
