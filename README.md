# EXFA Format

EXFA Format is the versioned, engine-independent file format for EVE fitting data. It stores a fit's calculable content together with the references and user-facing information needed by the web app, desktop app, and future clients. It also turns a saved fit into the stateless `FitRequest` accepted by EXFA Engine.

The TypeScript package is `@exfa/format` (ES modules); the Rust crate is `exfa-format`. Both implement the same JSON wire shapes and consume shared fixtures. The TypeScript types are normative. Object field names are `snake_case`, IDs are opaque strings, and EVE items are identified by numeric `type_id`; display names are never authoritative.

## The three layers

1. **Fit document — `exfa/fit@1`.** One saved fit. `fit` is the calculable ship and its fitted items. `refs` points to library characters, damage patterns, target profiles, and scenarios. `links` points to booster and projected fits. Alternatives, named branches, bounded history, and app-private `ui` data travel with the document.
2. **Library — `exfa/library@1`.** A collection of fit documents plus shared characters, damage patterns, target profiles, scenarios, fleets, and explicit folders. References use IDs so records can be renamed without changing their identity.
3. **Directory export.** `library.exfa.json` is the library index; each fit is a separate `<folder>/<safe name>.<id>.exfa.json` document. The folder is represented by its directory and is omitted from the document file. `toFiles` and `fromFiles` support the same layout for folder export, zip export, and desktop storage.

For example, a library with a fit in `PvP/Frigates` is stored as:

```text
library.exfa.json
PvP/
  Frigates/
    Rifter.fit-rifter.exfa.json
Scenarios/
  Command T3D.command-fit.exfa.json
```

## Repository layout

```text
schema/                         JSON Schema draft 2020-12
  common.schema.json
  fit-document.schema.json
  library.schema.json
  library-index.schema.json
  scenario.schema.json
ts/                             @exfa/format
rust/                           exfa-format
fixtures/                       shared TypeScript and Rust vectors
  engine/                       vendored EXFA Engine v0.2.0 request schema
```

## Fit document example

```json
{
  "format": "exfa/fit@1",
  "id": "fit-rifter",
  "name": "Rifter",
  "fit": {
    "ship": { "type_id": 587, "mode_type_id": null },
    "modules": [],
    "drones": [],
    "fighters": [],
    "implants": [],
    "boosters": [],
    "cargo": [],
    "projected": [],
    "fleet_buffs": [],
    "environment": { "effect_type_ids": [], "system_security": null },
    "options": { "factor_reload": false, "spool": 1, "rah": "adapt" }
  },
  "refs": {
    "character_id": "all5",
    "damage_pattern_id": "uniform",
    "target_profile_id": "none",
    "scenario_ids": []
  },
  "links": { "booster_fit_ids": [], "projected_fits": [] },
  "alternatives": [],
  "branches": [],
  "history": []
}
```

## Resolve a fit for the Engine

`resolve(library, fitId, { branch })` produces the Engine contract 1.5 request for that fit. It follows character/profile/scenario references, resolves depth-one booster and projected fits, and applies a named branch without changing the library. Missing characters fall back to `all5`; dangling optional profile, scenario, booster, or projected-fit references are omitted. An unknown root fit, selected branch, or explicit scenario target is reported as a `FormatError`. Nested fits do not recursively include their own projected fits or scenarios.

```ts
import { fromFiles, resolve } from '@exfa/format';

const library = fromFiles(importedFiles);
const request = resolve(library, 'fit-rifter', { branch: 'budget' });
// Send request to the EXFA Engine v0.2.0 RPC/CLI.
```

Scenario requests use the Engine's `scenarios[]` contract, including the attacker-speed and angle parameters. `scenarioRequest(library, scenario)` is also available for ad-hoc scenarios that are not saved in the library.

The package also exports `applyBranch`, `captureBranch`, `addAlternative`, `removeAlternative`, and `branchDiverged`; `recordHistory` and `restoreHistory`; `migrate` and `migrateFitDocument`; and the `toFiles`/`fromFiles` layout helpers. The Rust crate exposes typed serde models, `resolve`/`resolve_with_options`, `migrate`, and `read_directory`/`write_directory`.

## Use from the App, Engine, and desktop

- **EXFA App** stores `FitDocument` objects and shared records as a `Library`; `migrate` imports its legacy library and backup JSON. The App calls `resolve` before calculating with the Engine.
- **EXFA Engine** consumes the resolved `FitRequest` defined by contract 1.5. The format itself does not call the Engine or depend on an SDE.
- **Desktop and file-based clients** use `toFiles`/`fromFiles` for directory or archive export and import. The same stable paths are suitable for syncing and version control.
- **Rust clients** use the `exfa-format` crate for serde types, resolution, and directory read/write.

### Engine schema compatibility

The vendored request schema is the exact EXFA-Engine `v0.2.0` schema. App `toRequest` emits explicit nulls for some optional fields and uses `hisec`/`wspace`; that schema rejects those nulls and expects `highsec`/`wormhole`. `resolve` preserves the App request shape rather than silently rewriting it. The validation suite checks raw requests against a narrowly widened compatibility schema and checks a normalized view against the unmodified Engine schema. See [`fixtures/engine/README.md`](fixtures/engine/README.md) for the affected fields and the precise deviation.

This is a schema mismatch only: this package does not alter the vendored contract or infer values for absent App fields. Consumers that require strict JSON Schema validation against the unmodified file should normalize the documented nulls and security aliases before validating.

### TypeScript usage

```ts
import { fromFiles, resolve, toFiles } from '@exfa/format';

const library = fromFiles(importedFiles);
const engineRequest = resolve(library, 'fit-rifter');
const exportFiles = toFiles(library);
```

### Rust usage

```rust
use exfa_format::{read_directory, resolve, write_directory};

let library = read_directory("./fits")?;
let request = resolve(&library, "fit-rifter")?;
write_directory("./fits-export", &library)?;
```

For an App git dependency, the repository-root npm manifest delegates its `prepare` step to the TypeScript package and exposes the generated declarations and ESM entry point:

```json
{
  "dependencies": {
    "@exfa/format": "github:EX-CT/EXFA-Format#v1.0.0"
  }
}
```

The TypeScript source package can also be built and tested directly:

```sh
cd ts
npm ci
npm test
npm run build
npm run schema-validate
```

The Rust crate is standalone:

```sh
cd rust
cargo test
```

## Versioning and migration

`exfa/fit@1`, `exfa/library@1`, and `exfa/library-index@1` identify wire-format versions independently of package and crate version `1.0.0`. Patch releases preserve the v1 data model. A breaking persisted-shape change creates a new `@2` format and an explicit migration path; a reader must reject an unknown future `exfa/library@N` with `UNSUPPORTED_VERSION` rather than silently reinterpret it.

`migrate` accepts v1 libraries, legacy EXFA web libraries, and `eve-fit-web-library` backup wrappers. Missing v1 maps/arrays are normalized to empty collections. Legacy fits are converted to fit documents; unrecognized legacy fit fields are preserved under `doc.ui.legacy`. Unknown fields in current documents and library records are retained during read/write. History snapshots contain prior fit cores only, are grouped within ten minutes, and retain at most the newest 50 entries.

Safe file names replace `/\\:*?"<>|` and control characters with `_`, trim whitespace, and are capped at 80 characters; empty names become `fit`. Folder segments follow the same rule. IDs remain opaque in data and are percent-encoded only when a file name needs path-safe escaping.

## License

The library is distributed under LGPL-3.0-or-later. `LICENSE` contains the LGPL terms and `LICENSE.GPL-3.0` contains the incorporated GPL terms.
