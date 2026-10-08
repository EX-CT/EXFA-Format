import type { FitDocument, Group, JsonObject, Library, Package, Scenario } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

type MapKey = 'fits' | 'characters' | 'damage_patterns' | 'target_profiles' | 'scenarios' | 'fleets' | 'groups';
const MAP_KEYS: MapKey[] = ['characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets', 'groups', 'fits'];

interface Closure {
  fits: Map<string, FitDocument>;
  characters: Map<string, Library['characters'][string]>;
  damage_patterns: Map<string, Library['damage_patterns'][string]>;
  target_profiles: Map<string, Library['target_profiles'][string]>;
  scenarios: Map<string, Scenario>;
  groups: Map<string, Group>;
}

const emptyClosure = (): Closure => ({
  fits: new Map(), characters: new Map(), damage_patterns: new Map(),
  target_profiles: new Map(), scenarios: new Map(), groups: new Map(),
});

function collectScenario(library: Library, scenario: Scenario, out: Closure): void {
  if (out.scenarios.has(scenario.id)) return;
  out.scenarios.set(scenario.id, clone(scenario));
  const target = scenario.target as JsonObject;
  if (typeof target?.profile_id === 'string') {
    const profile = library.target_profiles[target.profile_id];
    if (profile) out.target_profiles.set(target.profile_id, clone(profile));
  }
  if (typeof target?.fit_id === 'string') {
    const doc = library.fits[target.fit_id];
    if (doc) collectFit(library, doc, out);
  }
}

function collectFit(library: Library, doc: FitDocument, out: Closure): void {
  if (out.fits.has(doc.id)) return;
  out.fits.set(doc.id, clone(doc));
  const { refs, links } = doc;
  const character = library.characters[refs.character_id];
  if (character) out.characters.set(refs.character_id, clone(character));
  const pattern = library.damage_patterns[refs.damage_pattern_id];
  if (pattern) out.damage_patterns.set(refs.damage_pattern_id, clone(pattern));
  const profile = library.target_profiles[refs.target_profile_id];
  if (profile) out.target_profiles.set(refs.target_profile_id, clone(profile));
  for (const id of refs.scenario_ids ?? []) {
    const scenario = library.scenarios[id];
    if (scenario) collectScenario(library, scenario, out);
  }
  for (const id of links.booster_fit_ids ?? []) {
    const linked = library.fits[id];
    if (linked) collectFit(library, linked, out);
  }
  for (const link of links.projected_fits ?? []) {
    const linked = library.fits[link.fit_id];
    if (linked) collectFit(library, linked, out);
  }
}

function closureLibrary(library: Library, out: Closure): Library {
  const usedFolders = new Set<string>();
  for (const doc of out.fits.values()) if (doc.folder) usedFolders.add(doc.folder);
  for (const group of out.groups.values()) if (group.folder) usedFolders.add(group.folder);
  return {
    format: 'exfa/library@1',
    folders: library.folders.filter((folder) => usedFolders.has(folder)),
    fits: Object.fromEntries(out.fits),
    characters: Object.fromEntries(out.characters),
    damage_patterns: Object.fromEntries(out.damage_patterns),
    target_profiles: Object.fromEntries(out.target_profiles),
    scenarios: Object.fromEntries(out.scenarios),
    fleets: {},
    groups: Object.fromEntries(out.groups),
  };
}

/** Packages a single fit document plus its transitive reference/link closure into an `exfa/package@1`. */
export function packageFit(library: Library, doc: FitDocument): Package {
  const out = emptyClosure();
  collectFit(library, doc, out);
  return { format: 'exfa/package@1', root: { kind: 'fit', id: doc.id }, library: closureLibrary(library, out) };
}

/** Packages a group plus every actor's fit document (and their closures) into an `exfa/package@1`. */
export function packageGroup(library: Library, group: Group): Package {
  const out = emptyClosure();
  for (const actor of group.actors ?? []) {
    const doc = library.fits[actor.fit_id];
    if (doc) collectFit(library, doc, out);
  }
  out.groups.set(group.id, clone(group));
  return { format: 'exfa/package@1', root: { kind: 'group', id: group.id }, library: closureLibrary(library, out) };
}

// ---------------------------------------------------------------- merge

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

const KIND_LABEL: Record<MapKey, string> = {
  fits: 'fit', characters: 'character', damage_patterns: 'damage_pattern',
  target_profiles: 'target_profile', scenarios: 'scenario', fleets: 'fleet', groups: 'group',
};

function remapEntity(key: MapKey, entity: JsonObject, renames: Record<MapKey, Map<string, string>>): void {
  const remap = (map: MapKey, id: unknown) => (typeof id === 'string' ? renames[map].get(id) ?? id : id);
  if (key === 'fits') {
    const doc = entity as unknown as FitDocument;
    doc.refs.character_id = remap('characters', doc.refs.character_id) as string;
    doc.refs.damage_pattern_id = remap('damage_patterns', doc.refs.damage_pattern_id) as string;
    doc.refs.target_profile_id = remap('target_profiles', doc.refs.target_profile_id) as string;
    doc.refs.scenario_ids = (doc.refs.scenario_ids ?? []).map((id) => remap('scenarios', id) as string);
    doc.links.booster_fit_ids = (doc.links.booster_fit_ids ?? []).map((id) => remap('fits', id) as string);
    for (const link of doc.links.projected_fits ?? []) link.fit_id = remap('fits', link.fit_id) as string;
  } else if (key === 'scenarios') {
    const target = (entity as unknown as Scenario).target as JsonObject;
    if (typeof target?.profile_id === 'string') target.profile_id = remap('target_profiles', target.profile_id);
    if (typeof target?.fit_id === 'string') target.fit_id = remap('fits', target.fit_id);
  } else if (key === 'groups') {
    for (const actor of (entity as unknown as Group).actors ?? []) actor.fit_id = remap('fits', actor.fit_id) as string;
  } else if (key === 'fleets') {
    for (const member of (entity as { members?: { fit_id: string }[] }).members ?? []) member.fit_id = remap('fits', member.fit_id) as string;
  }
}

function danglingIssues(key: MapKey, id: string, entity: JsonObject, target: Library, issues: string[]): void {
  const check = (map: MapKey, refId: unknown, field: string) => {
    if (typeof refId === 'string' && refId && target[map][refId] === undefined) {
      issues.push(`${KIND_LABEL[key]} '${id}': dangling ${field} reference '${refId}'`);
    }
  };
  if (key === 'fits') {
    const doc = entity as unknown as FitDocument;
    check('characters', doc.refs.character_id, 'character_id');
    check('damage_patterns', doc.refs.damage_pattern_id, 'damage_pattern_id');
    check('target_profiles', doc.refs.target_profile_id, 'target_profile_id');
    for (const refId of doc.refs.scenario_ids ?? []) check('scenarios', refId, 'scenario_ids');
    for (const refId of doc.links.booster_fit_ids ?? []) check('fits', refId, 'booster_fit_ids');
    for (const link of doc.links.projected_fits ?? []) check('fits', link.fit_id, 'projected_fits');
  } else if (key === 'scenarios') {
    const scenarioTarget = (entity as unknown as Scenario).target as JsonObject;
    check('target_profiles', scenarioTarget?.profile_id, 'profile_id');
    check('fits', scenarioTarget?.fit_id, 'fit_id');
  } else if (key === 'groups') {
    for (const actor of (entity as unknown as Group).actors ?? []) check('fits', actor.fit_id, 'fit_id');
  } else if (key === 'fleets') {
    for (const member of (entity as { members?: { fit_id: string }[] }).members ?? []) check('fits', member.fit_id, 'fit_id');
  }
}

export interface MergePolicy { onConflict?: 'rename' | 'replace' | 'skip' }
export interface MergeResult { issues: string[] }

/**
 * Merges a package's dependency closure into a target library. `rename` (default) mints `imp-*` ids for colliding
 * entries with different content and remaps references inside imported entities; `replace` overwrites; `skip`
 * keeps the existing entry. Identical entries are not conflicts. Returns human-readable issues for conflicts and
 * references that stay dangling after the merge.
 */
export function mergePackage(target: Library, pkg: Package, policy: MergePolicy = {}): MergeResult {
  const onConflict = policy.onConflict ?? 'rename';
  const issues: string[] = [];
  const renames = Object.fromEntries(MAP_KEYS.map((key) => [key, new Map<string, string>()])) as Record<MapKey, Map<string, string>>;
  const placements: { key: MapKey; sourceId: string; entity: JsonObject }[] = [];

  for (const key of MAP_KEYS) {
    const incoming = (pkg.library[key] ?? {}) as Record<string, JsonObject>;
    const existing = target[key] as Record<string, JsonObject>;
    for (const [id, entity] of Object.entries(incoming)) {
      if (existing[id] === undefined) {
        placements.push({ key, sourceId: id, entity: clone(entity) });
      } else if (deepEqual(existing[id], entity)) {
        continue;
      } else if (onConflict === 'skip') {
        issues.push(`${KIND_LABEL[key]} '${id}': conflict, kept existing`);
      } else if (onConflict === 'replace') {
        issues.push(`${KIND_LABEL[key]} '${id}': conflict, replaced existing`);
        placements.push({ key, sourceId: id, entity: clone(entity) });
      } else {
        let newId = `imp-${uid()}`;
        const taken = () => existing[newId] !== undefined || [...renames[key].values()].includes(newId);
        while (taken()) newId = `imp-${uid()}`;
        renames[key].set(id, newId);
        placements.push({ key, sourceId: id, entity: clone(entity) });
        issues.push(`${KIND_LABEL[key]} '${id}': conflict, renamed to '${newId}'`);
      }
    }
  }

  const merged: { key: MapKey; id: string; entity: JsonObject }[] = [];
  for (const { key, sourceId, entity } of placements) {
    remapEntity(key, entity, renames);
    const id = renames[key].get(sourceId) ?? sourceId;
    entity.id = id;
    (target[key] as Record<string, JsonObject>)[id] = entity;
    merged.push({ key, id, entity });
  }
  target.folders = [...new Set([...target.folders, ...(pkg.library.folders ?? [])])];

  for (const { key, id, entity } of merged) danglingIssues(key, id, entity, target, issues);
  return { issues };
}
