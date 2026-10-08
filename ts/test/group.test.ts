import { describe, expect, it } from 'vitest';
import {
  compileGroup,
  newGroup,
  type Fit,
  type FitDocument,
  type FitRequest,
  type Group,
  type Library,
} from '../src';
import { loadFormatSchemas } from '../scripts/engine-schema.mjs';

const makeDoc = (id: string, name: string, fit?: Partial<Fit>): FitDocument => ({
  format: 'exfa/fit@1',
  id,
  name,
  fit: {
    ship: { type_id: 587, mode_type_id: null },
    modules: [],
    drones: [],
    fighters: [],
    implants: [],
    boosters: [],
    cargo: [],
    projected: [],
    fleet_buffs: [],
    environment: { effect_type_ids: [], system_security: null },
    options: { factor_reload: false, spool: 1, rah: 'adapt' },
    ...fit,
  },
  refs: { character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', scenario_ids: [] },
  links: { booster_fit_ids: [], projected_fits: [] },
  alternatives: [],
  branches: [],
  history: [],
});

const makeLibrary = (): Library => ({
  format: 'exfa/library@1',
  folders: [],
  fits: {
    'logi-fit': makeDoc('logi-fit', 'Logistics', {
      modules: [
        { id: 'rep-1', type_id: 11355, slot: 'high', state: 'active' },
        { id: 'rep-2', type_id: 11355, slot: 'high', state: 'active' },
      ],
      drones: [{ id: 'drone-1', type_id: 2488, quantity: 2, active: 2 }],
      fighters: [{ id: 'ftr-1', type_id: 2305, quantity: 1, active: true }],
      cargo: [{ id: 'cargo-1', type_id: 21898, quantity: 5 }],
    }),
    'dps-a': makeDoc('dps-a', 'DPS A', { ship: { type_id: 624, mode_type_id: null } }),
    'dps-b': makeDoc('dps-b', 'DPS B', { ship: { type_id: 11174, mode_type_id: null } }),
  },
  characters: { all5: { id: 'all5', name: 'All 5', default_level: 5, levels: {} } },
  damage_patterns: {},
  target_profiles: {},
  scenarios: {},
  fleets: {},
  groups: {},
});

const fitsOf = (request: { batch: Record<string, unknown> }) =>
  request.batch.fits as { id: string; label: string; fit: FitRequest }[];

describe('newGroup', () => {
  it('creates an empty exfa/group@1 document with a generated id', () => {
    const group = newGroup();
    expect(group.format).toBe('exfa/group@1');
    expect(group.id).toBeTruthy();
    expect(group.actors).toEqual([]);
    expect(group.relations).toEqual([]);
    expect(newGroup('Named', 'fixed-id')).toMatchObject({ id: 'fixed-id', name: 'Named' });
  });
});

describe('compileGroup', () => {
  it('emits one batch.fits entry per actor in order, with id and label', async () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [
        { id: 'logi', fit_id: 'logi-fit', label: 'Logi' },
        { id: 'dps', fit_id: 'dps-a' },
      ],
    };
    const { request, issues } = compileGroup(library, group);
    expect(issues).toEqual([]);
    expect(request).toMatchObject({ format: 'exfa/compute@1', operation: 'batch' });
    expect(request.batch.batch_version).toBe(1);
    const fits = fitsOf(request);
    expect(fits.map((entry) => entry.id)).toEqual(['logi', 'dps']);
    expect(fits[0].label).toBe('Logi');
    expect(fits[1].label).toBe('DPS A');
    expect(fits[0].fit.modules.map((module) => module.id)).toEqual(['rep-1', 'rep-2']);

    const validators = await loadFormatSchemas();
    expect(validators.validateCompute?.(request), JSON.stringify(validators.validateCompute?.errors)).toBe(true);
  });

  it('projects the full source fit with a classified select whitelist', () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [
        { id: 'logi', fit_id: 'logi-fit' },
        { id: 'dps', fit_id: 'dps-a' },
      ],
      relations: [{
        id: 'rel-1', kind: 'project', source: 'logi', targets: ['dps'],
        source_item_ids: ['rep-1', 'drone-1', 'ftr-1'], amount: 2, distance_m: 8000,
      }],
    };
    const { request, issues } = compileGroup(library, group);
    expect(issues).toEqual([]);
    const dps = fitsOf(request).find((entry) => entry.id === 'dps')!.fit;
    expect(dps.projected).toHaveLength(1);
    const projected = dps.projected[0] as Extract<NonNullable<typeof dps.projected[0]>, { kind: 'fit' }>;
    expect(projected.kind).toBe('fit');
    expect(projected.amount).toBe(2);
    expect(projected.distance_m).toBe(8000);
    expect(projected.select).toEqual({ module_ids: ['rep-1'], drone_ids: ['drone-1'], fighter_ids: ['ftr-1'] });
    expect(projected.fit.modules.map((module) => module.id)).toEqual(['rep-1', 'rep-2']);
  });

  it('omits select entirely when the relation has no source_item_ids', () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [{ id: 'logi', fit_id: 'logi-fit' }, { id: 'dps', fit_id: 'dps-a' }],
      relations: [{ id: 'rel-1', kind: 'project', source: 'logi', targets: ['dps'] }],
    };
    const { request, issues } = compileGroup(library, group);
    expect(issues).toEqual([]);
    const dps = fitsOf(request).find((entry) => entry.id === 'dps')!.fit;
    const projected = dps.projected[0] as Record<string, unknown>;
    expect(projected.kind).toBe('fit');
    expect(projected.amount).toBe(1);
    expect(projected.distance_m).toBeNull();
    expect('select' in projected).toBe(false);
  });

  it('pushes command relations onto fleet.booster_fits', () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [{ id: 'boost', fit_id: 'logi-fit' }, { id: 'dps', fit_id: 'dps-a' }],
      relations: [{ id: 'rel-1', kind: 'command', source: 'boost', targets: ['dps'] }],
    };
    const { request, issues } = compileGroup(library, group);
    expect(issues).toEqual([]);
    const dps = fitsOf(request).find((entry) => entry.id === 'dps')!.fit;
    expect(dps.fleet.booster_fits).toHaveLength(1);
    expect(dps.fleet.booster_fits[0].modules.map((module) => module.id)).toEqual(['rep-1', 'rep-2']);
    expect(dps.projected).toHaveLength(0);
  });

  it('skips disabled relations and reports missing actors, targets, and item ids', () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [{ id: 'logi', fit_id: 'logi-fit' }, { id: 'dps', fit_id: 'dps-a' }, { id: 'ghost', fit_id: 'missing-fit' }],
      relations: [
        { id: 'rel-off', kind: 'project', source: 'logi', targets: ['dps'], enabled: false },
        { id: 'rel-baditem', kind: 'project', source: 'logi', targets: ['dps'], source_item_ids: ['rep-1', 'nope'] },
        { id: 'rel-badtarget', kind: 'project', source: 'logi', targets: ['ghost', 'nobody'] },
        { id: 'rel-badsource', kind: 'command', source: 'ghost', targets: ['dps'] },
      ],
    };
    const { request, issues } = compileGroup(library, group);
    const dps = fitsOf(request).find((entry) => entry.id === 'dps')!.fit;
    // rel-off skipped; rel-baditem still projects (with issue); bad target/source produce issues only.
    expect(dps.projected).toHaveLength(1);
    expect((dps.projected[0] as { select?: { module_ids?: string[] } }).select?.module_ids).toEqual(['rep-1']);
    expect(issues.some((issue) => issue.includes('missing-fit'))).toBe(true);
    expect(issues.some((issue) => issue.includes('nope'))).toBe(true);
    expect(issues.some((issue) => issue.includes("'ghost'"))).toBe(true);
    expect(issues.some((issue) => issue.includes("'nobody'"))).toBe(true);
    expect(issues.some((issue) => issue.includes('rel-badsource'))).toBe(true);
    // the ghost actor is skipped from batch.fits
    expect(fitsOf(request).map((entry) => entry.id)).toEqual(['logi', 'dps']);
  });

  it('deep-clones the projected source fit per target', () => {
    const library = makeLibrary();
    const group: Group = {
      ...newGroup('Fleet', 'g1'),
      actors: [{ id: 'logi', fit_id: 'logi-fit' }, { id: 'a', fit_id: 'dps-a' }, { id: 'b', fit_id: 'dps-b' }],
      relations: [{ id: 'rel-1', kind: 'project', source: 'logi', targets: ['a', 'b'] }],
    };
    const { request } = compileGroup(library, group);
    const fits = fitsOf(request);
    const fitA = (fits.find((entry) => entry.id === 'a')!.fit.projected[0] as { fit: FitRequest }).fit;
    const fitB = (fits.find((entry) => entry.id === 'b')!.fit.projected[0] as { fit: FitRequest }).fit;
    expect(fitA).not.toBe(fitB);
    expect(fitA).toEqual(fitB);
    (fitA.modules[0] as { type_id: number }).type_id = 999999;
    expect(fitB.modules[0].type_id).toBe(11355);
    const source = fits.find((entry) => entry.id === 'logi')!.fit;
    expect(source.modules[0].type_id).toBe(11355);
  });
});
