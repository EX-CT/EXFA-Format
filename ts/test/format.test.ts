import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addAlternative,
  applyBranch,
  branchDiverged,
  captureBranch,
  fromFiles,
  migrate,
  migrateFitDocument,
  recordHistory,
  removeAlternative,
  resolve,
  restoreHistory,
  toFiles,
  type FitDocument,
  type Library,
} from '../src';
import { fixturePath, loadEngineValidators, loadFormatSchemas } from '../scripts/engine-schema.mjs';

const readFixture = <T>(path: string): T => JSON.parse(readFileSync(fixturePath(path), 'utf8')) as T;
const library = readFixture<Library>('fixtures/library.json');
const requests = readFixture<Record<string, unknown>>('fixtures/requests.json');
const expectedMigrated = readFixture<Library>('fixtures/expected-migrated-library.json');
const legacyBackup = readFixture<unknown>('fixtures/legacy-v0.json');

describe('App FitRequest parity', () => {
  for (const fitId of ['app-basic', 'app-nested-a', 'app-nested-b']) {
    it(`resolves the copied App request for ${fitId}`, () => {
      expect(resolve(library, fitId)).toEqual(requests[fitId]);
    });
  }

  it('resolves mutation, spool, alternatives, scenarios, projections, fleet command member, and character fallback', () => {
    expect(resolve(library, 'complex')).toEqual(requests.complex);
    expect(resolve(library, 'command')).toEqual(requests.command);
  });

  it('validates resolved requests against the vendored Engine schema and documented App compatibility view', async () => {
    const { validateExact, validateAppCompatible, engineSchemaView } = await loadEngineValidators();
    for (const fitId of Object.keys(requests)) {
      const request = resolve(library, fitId);
      expect(validateAppCompatible(request), JSON.stringify(validateAppCompatible.errors)).toBe(true);
      expect(validateExact(engineSchemaView(request)), JSON.stringify(validateExact.errors)).toBe(true);
    }
  });
});

describe('branches and alternatives', () => {
  it('applies a branch to every module in a shared link group', () => {
    const source = library.fits.complex;
    const budget = applyBranch(source, 'budget');
    expect(budget.fit.modules.map((module) => module.type_id)).toEqual([2874, 2874]);
    expect(budget.fit.modules.map((module) => module.charge_type_id)).toEqual([21899, 21899]);
    expect(budget.active_branch).toBe('budget');
    expect(branchDiverged(budget)).toBe(false);
    expect(branchDiverged({ ...budget, fit: { ...budget.fit, modules: [{ ...budget.fit.modules[0], type_id: 2873 }, budget.fit.modules[1]] } })).toBe(true);
  });

  it('captures a branch and removes alternatives from items and picks', () => {
    const captured = captureBranch(library.fits.complex, 'Captured');
    expect(captured.branches.at(-1)?.name).toBe('Captured');
    expect(captured.branches.at(-1)?.picks['weapon-choice']).toBe(0);
    const extended = addAlternative(library.fits.complex, { list: 'modules', index: 0 }, [3000]);
    const newId = extended.fit.modules[0].alt_id;
    expect(extended.fit.modules.map((module) => module.alt_id)).toEqual([newId, newId]);
    expect(extended.alternatives[0].options.map((option) => option.type_id)).toContain(3000);
    const removed = removeAlternative(extended, newId);
    expect(removed.fit.modules.every((module) => module.alt_id === undefined)).toBe(true);
    expect(removed.branches.every((branch) => !(newId in branch.picks))).toBe(true);
  });

  it('detects divergence when two alternatives use the same type with different charges', () => {
    const source = library.fits.complex;
    const modified = {
      ...source,
      alternatives: [{
        id: 'weapon-choice',
        options: [
          { type_id: 2873, charge_type_id: 21898 },
          { type_id: 2873, charge_type_id: 777 },
        ],
      }],
      branches: [{ id: 'charged', name: 'Charged', picks: { 'weapon-choice': 1 } }],
      active_branch: 'charged',
    } as FitDocument;
    expect(branchDiverged(modified)).toBe(true);
    expect(applyBranch(modified, 'charged').fit.modules.map((module) => module.charge_type_id)).toEqual([777, 777]);
  });
});

describe('migration, history, and files', () => {
  it('migrates the legacy App backup and preserves unknown legacy data', () => {
    expect(migrate(legacyBackup)).toEqual(expectedMigrated);
  });

  it('rejects future library versions', () => {
    expect(() => migrate({ format: 'exfa/library@2' })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
  });

  it('coalesces history within ten minutes, caps it, and pushes the current fit before restore', () => {
    const source = library.fits['app-basic'];
    const changed = { ...source, fit: { ...source.fit, ship: { type_id: 603, mode_type_id: null } } };
    const start = new Date('2026-01-01T00:00:00.000Z');
    const first = recordHistory(source, changed, start);
    expect(first.history).toHaveLength(1);
    expect(first.history[0].fit).toEqual(source.fit);
    const moreChanged = { ...first, fit: { ...first.fit, ship: { type_id: 604, mode_type_id: null } } };
    const coalesced = recordHistory(first, moreChanged, new Date(start.getTime() + 5 * 60_000));
    expect(coalesced.history).toHaveLength(1);
    const separatedFit = { ...coalesced, fit: { ...coalesced.fit, ship: { type_id: 605, mode_type_id: null } } };
    const separated = recordHistory(coalesced, separatedFit, new Date(start.getTime() + 11 * 60_000));
    expect(separated.history).toHaveLength(2);
    const full = {
      ...source,
      history: Array.from({ length: 50 }, (_, index) => ({
        at: new Date(start.getTime() + index * 11 * 60_000).toISOString(),
        fit: source.fit,
      })),
    };
    const cappedWithHistory = recordHistory(
      { ...source, history: full.history },
      { ...changed, history: full.history },
      new Date(start.getTime() + 51 * 11 * 60_000),
    );
    expect(cappedWithHistory.history).toHaveLength(50);
    const restored = restoreHistory(first, 0, new Date(start.getTime() + 12 * 60_000));
    expect(restored.fit).toEqual(source.fit);
    expect(restored.history.at(-1)?.fit).toEqual(changed.fit);
  });

  it('round-trips the fixture library through deterministic files and normalized folders', () => {
    const files = toFiles(library);
    expect(files[0].path).toBe('library.exfa.json');
    expect(files.find((file) => file.path === 'PvP/Frigates/R.app-basic.exfa.json')).toBeDefined();
    expect(files.every((file) => file.text.endsWith('\n'))).toBe(true);
    const normalized = fromFiles(files.map((file) => ({ ...file, path: `./${file.path}` })));
    expect(normalized).toEqual(library);
    expect(toFiles(normalized)).toEqual(files);
    expect(() => fromFiles([{ path: '../outside.exfa.json', text: '{}' }])).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_PATH' }),
    );
  });

  it('validates library, FitDocument, and generated index fixtures with the JSON schemas', async () => {
    const validators = await loadFormatSchemas();
    expect(validators.validateLibrary?.(library), JSON.stringify(validators.validateLibrary?.errors)).toBe(true);
    for (const document of Object.values(library.fits)) {
      expect(validators.validateFitDocument?.(document), JSON.stringify(validators.validateFitDocument?.errors)).toBe(true);
    }
    const index = JSON.parse(toFiles(library)[0].text);
    expect(validators.validateLibraryIndex?.(index), JSON.stringify(validators.validateLibraryIndex?.errors)).toBe(true);
  });
});

it('uses FitDocument migration for standalone v1 documents', () => {
  const document = library.fits['app-basic'];
  expect(migrateFitDocument(document)).toEqual(document);
  expect(document).toBeDefined();
});
