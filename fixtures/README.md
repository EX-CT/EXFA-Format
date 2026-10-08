# Shared fixtures

- `library.json` contains five v1 fits: the App Rifter request, the App nested A/B scenario, a fit with mutation and spool, module alternatives with two branches, linked projected fits, fleet command membership, profile/fit-target scenarios, a T3D mode, a missing-character fallback, and one `exfa/group@1` group with project/command relations.
- `requests.json` contains copied expected FitRequest JSON for the App's Rifter and nested-fit `toRequest` cases in `EXFA-App/apps/web/src/fit/model.test.ts`, plus expected requests for the other format scenarios. Format tests compare `resolve` to these values; they do not import App code.
- `legacy-v0.json` is an `eve-fit-web-library` v2 backup containing legacy fits, and `expected-migrated-library.json` is its v1 library result. Unknown legacy data is intentionally included to exercise preservation.
- `engine/fit-request.schema.json` is the unmodified Engine v0.2.0 schema; its provenance and the App null/security-label incompatibility are documented in [`engine/README.md`](engine/README.md).
