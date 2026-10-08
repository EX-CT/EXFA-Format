import { describe, expect, it } from 'vitest';
import {
  mergePackage,
  newGroup,
  packageFit,
  packageGroup,
  type Fit,
  type FitDocument,
  type Library,
  type Package,
} from '../src';
import { loadFormatSchemas } from '../scripts/engine-schema.mjs';

const makeDoc = (
  id: string,
  name: string,
  options: {
    fit?: Partial<Fit>;
    refs?: Partial<FitDocument['refs']>;
    links?: Partial<FitDocument['links']>;
    folder?: string;
  } = {},
): FitDocument => ({
  format: 'exfa/fit@1',
  id,
  name,
  ...(options.folder ? { folder: options.folder } : {}),
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
    ...options.fit,
  },
  refs: { character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', scenario_ids: [], ...options.refs },
  links: { booster_fit_ids: [], projected_fits: [], ...options.links },
  alternatives: [],
  branches: [],
  history: [],
});

const makeLibrary = (): Library => ({
  format: 'exfa/library@1',
  folders: ['PvP', 'Unused'],
  fits: {
    main: makeDoc('main', 'Main', {
      folder: 'PvP',
      refs: { character_id: 'pilot', damage_pattern_id: 'dp', target_profile_id: 'tp', scenario_ids: ['sc'] },
      links: { booster_fit_ids: ['boost'], projected_fits: [{ fit_id: 'proj', amount: 1, distance_m: null }] },
    }),
    boost: makeDoc('boost', 'Booster', {
      refs: { character_id: 'pilot' },
      links: { projected_fits: [{ fit_id: 'deep', amount: 1, distance_m: 5000 }] },
    }),
    deep: makeDoc('deep', 'Deep link'),
    proj: makeDoc('proj', 'Projection', { refs: { scenario_ids: ['sc-fit'] } }),
    'target-fit': makeDoc('target-fit', 'Scenario target'),
    unrelated: makeDoc('unrelated', 'Unrelated'),
  },
  characters: {
    all5: { id: 'all5', name: 'All 5', default_level: 5, levels: {} },
    pilot: { id: 'pilot', name: 'Pilot', default_level: 4, levels: { '3300': 3 } },
    other: { id: 'other', name: 'Other', default_level: 5, levels: {} },
  },
  damage_patterns: { dp: { id: 'dp', name: 'EM heavy', em: 1, thermal: 0, kinetic: 0, explosive: 0 } },
  target_profiles: {
    tp: { id: 'tp', name: 'Target', em: 0.2, thermal: 0.2, kinetic: 0.2, explosive: 0.2 },
    tp2: { id: 'tp2', name: 'Scenario profile', em: 0.5, thermal: 0.5, kinetic: 0.5, explosive: 0.5 },
  },
  scenarios: {
    sc: { id: 'sc', name: 'Profile scenario', target: { profile_id: 'tp2' }, params: {} },
    'sc-fit': { id: 'sc-fit', name: 'Fit scenario', target: { fit_id: 'target-fit', resist_mode: 'auto' }, params: {} },
    'sc-unused': { id: 'sc-unused', name: 'Unused', target: { profile_id: 'tp2' }, params: {} },
  },
  fleets: { 'fleet-1': { id: 'fleet-1', name: 'Fleet', members: [{ fit_id: 'main', role: 'member' }] } },
  groups: {},
});

describe('packageFit', () => {
  it('collects the transitive dependency closure of a fit document', async () => {
    const library = makeLibrary();
    const pkg = packageFit(library, library.fits.main);
    expect(pkg).toMatchObject({ format: 'exfa/package@1', root: { kind: 'fit', id: 'main' } });
    expect(Object.keys(pkg.library.fits).sort()).toEqual(['boost', 'deep', 'main', 'proj', 'target-fit']);
    expect(Object.keys(pkg.library.characters).sort()).toEqual(['all5', 'pilot']);
    expect(Object.keys(pkg.library.damage_patterns)).toEqual(['dp']);
    expect(Object.keys(pkg.library.target_profiles).sort()).toEqual(['tp', 'tp2']);
    expect(Object.keys(pkg.library.scenarios).sort()).toEqual(['sc', 'sc-fit']);
    expect(pkg.library.fleets).toEqual({});
    expect(pkg.library.groups).toEqual({});
    expect(pkg.library.folders).toEqual(['PvP']);

    const validators = await loadFormatSchemas();
    expect(validators.validatePackage?.(pkg), JSON.stringify(validators.validatePackage?.errors)).toBe(true);
  });
});

describe('packageGroup', () => {
  it('collects the group and every actor fit closure', () => {
    const library = makeLibrary();
    const group = {
      ...newGroup('Squad', 'squad-1'),
      actors: [
        { id: 'a', fit_id: 'main' },
        { id: 'b', fit_id: 'deep' },
        { id: 'gone', fit_id: 'missing' },
      ],
    };
    const pkg = packageGroup(library, group);
    expect(pkg.root).toEqual({ kind: 'group', id: 'squad-1' });
    expect(pkg.library.groups['squad-1']).toEqual(group);
    expect(Object.keys(pkg.library.fits).sort()).toEqual(['boost', 'deep', 'main', 'proj', 'target-fit']);
  });
});

describe('mergePackage', () => {
  it('merges a clean package and reports dangling references', () => {
    const target = makeLibrary();
    const pkg: Package = {
      format: 'exfa/package@1',
      root: { kind: 'fit', id: 'imported' },
      library: {
        format: 'exfa/library@1',
        folders: ['Imported'],
        fits: {
          imported: makeDoc('imported', 'Imported', { refs: { character_id: 'ghost' }, folder: 'Imported' }),
        },
        characters: {},
        damage_patterns: {},
        target_profiles: {},
        scenarios: {},
        fleets: {},
        groups: {},
      },
    };
    const { issues } = mergePackage(target, pkg);
    expect(target.fits.imported.name).toBe('Imported');
    expect(target.folders).toContain('Imported');
    expect(issues.some((issue) => issue.includes('ghost'))).toBe(true);
  });

  it('renames conflicting entries and remaps references inside imported docs and groups', () => {
    const target = makeLibrary();
    const group = { ...newGroup('Squad', 'squad-1'), actors: [{ id: 'a', fit_id: 'main' }] };
    const pkg: Package = {
      format: 'exfa/package@1',
      root: { kind: 'group', id: 'squad-1' },
      library: {
        format: 'exfa/library@1',
        folders: [],
        fits: {
          main: makeDoc('main', 'Conflicting main', { links: { booster_fit_ids: ['boost'] } }),
          boost: makeDoc('boost', 'Conflicting boost'),
        },
        characters: {},
        damage_patterns: {},
        target_profiles: {},
        scenarios: {},
        fleets: {},
        groups: { 'squad-1': group },
      },
    };
    const { issues } = mergePackage(target, pkg);
    const renamed = issues.filter((issue) => issue.includes('renamed'));
    expect(renamed).toHaveLength(2);
    const importedMain = Object.entries(target.fits).find(([id]) => id.startsWith('imp-') && target.fits[id].name === 'Conflicting main');
    const importedBoost = Object.entries(target.fits).find(([id]) => id.startsWith('imp-') && target.fits[id].name === 'Conflicting boost');
    expect(importedMain).toBeDefined();
    expect(importedBoost).toBeDefined();
    const [mainId] = importedMain!;
    const [boostId] = importedBoost!;
    expect(target.fits[mainId].id).toBe(mainId);
    expect(target.fits[mainId].links.booster_fit_ids).toEqual([boostId]);
    expect(target.groups['squad-1'].actors[0].fit_id).toBe(mainId);
    // pre-existing entries untouched
    expect(target.fits.main.name).toBe('Main');
    expect(target.fits.boost.name).toBe('Booster');
  });

  it('supports skip and replace policies and ignores identical content', () => {
    const target = makeLibrary();
    const identical = structuredClone(target.fits.deep);
    const pkg: Package = {
      format: 'exfa/package@1',
      root: { kind: 'fit', id: 'main' },
      library: {
        format: 'exfa/library@1', folders: [],
        fits: { main: makeDoc('main', 'Changed'), deep: identical },
        characters: {}, damage_patterns: {}, target_profiles: {}, scenarios: {}, fleets: {}, groups: {},
      },
    };
    const skipped = mergePackage(target, structuredClone(pkg), { onConflict: 'skip' });
    expect(target.fits.main.name).toBe('Main');
    expect(skipped.issues.some((issue) => issue.includes('kept existing'))).toBe(true);
    expect(skipped.issues.some((issue) => issue.includes("'deep'"))).toBe(false);

    const replaced = mergePackage(target, structuredClone(pkg), { onConflict: 'replace' });
    expect(target.fits.main.name).toBe('Changed');
    expect(replaced.issues.some((issue) => issue.includes('replaced existing'))).toBe(true);
  });
});
