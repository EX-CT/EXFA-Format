import { FormatError, type Fit, type FitDocument, type Library } from './types.js';

type Obj = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const record = <T>(value: unknown): Record<string, T> => object(value) as Record<string, T>;
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const text = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback;

function omit(value: Obj, keys: string[]): Obj {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function normalizedFolders(value: unknown): string[] {
  const paths = Array.isArray(value) ? value : [];
  return [...new Set(paths.flatMap((path) => {
    if (typeof path !== 'string') return [];
    const normalized = path.split('/').map((part) => part.trim()).filter(Boolean).join('/');
    return normalized ? [normalized] : [];
  }))];
}

function withLegacyUi(uiValue: unknown, legacy: Obj): Record<string, unknown> | undefined {
  const ui = { ...object(uiValue) };
  const existingLegacy = object(ui.legacy);
  if (Object.keys(legacy).length) ui.legacy = { ...existingLegacy, ...legacy };
  return Object.keys(ui).length ? ui : undefined;
}

function normalizeFit(fitValue: unknown): Fit {
  const fit = clone(object(fitValue));
  const environment = object(fit.environment);
  const options = object(fit.options);
  return {
    ...fit,
    ship: { ...object(fit.ship), type_id: Number(object(fit.ship).type_id ?? 0) },
    modules: list(fit.modules),
    drones: list(fit.drones),
    fighters: list(fit.fighters),
    implants: list(fit.implants),
    boosters: list(fit.boosters),
    cargo: list(fit.cargo),
    projected: list(fit.projected),
    fleet_buffs: list(fit.fleet_buffs),
    environment: { ...environment, effect_type_ids: list(environment.effect_type_ids), system_security: (environment.system_security ?? null) as Fit['environment']['system_security'] },
    ...(fit.overrides !== undefined ? { overrides: list(fit.overrides) } : {}),
    options: { factor_reload: false, spool: 1, rah: 'adapt', ...options } as Fit['options'],
  } as Fit;
}

export function migrateFitDocument(value: unknown, fallbackId = ''): FitDocument {
  const source = clone(object(value));
  if (source.format === 'exfa/fit@1') {
    const refs = object(source.refs), links = object(source.links);
    return {
      ...source,
      format: 'exfa/fit@1',
      id: text(source.id, fallbackId),
      name: text(source.name, 'Untitled fit'),
      fit: normalizeFit(source.fit),
      refs: {
        ...refs,
        character_id: text(refs.character_id, 'all5'),
        damage_pattern_id: text(refs.damage_pattern_id, 'uniform'),
        target_profile_id: text(refs.target_profile_id, 'none'),
        scenario_ids: list(refs.scenario_ids),
      },
      links: {
        ...links,
        booster_fit_ids: list(links.booster_fit_ids),
        projected_fits: list(links.projected_fits),
      },
      alternatives: list(source.alternatives),
      branches: list(source.branches),
      history: list(source.history),
    } as FitDocument;
  }

  const known = [
    'id', 'name', 'ship_type_id', 'mode_type_id', 'modules', 'drones', 'fighters', 'implants', 'boosters', 'cargo',
    'projected', 'fleet', 'environment', 'system_security', 'character_id', 'damage_pattern_id', 'target_profile_id',
    'options', 'notes', 'overrides', 'folder', 'tags', 'created', 'modified', 'ui',
  ];
  const fleet = object(source.fleet);
  const oldProjected = list<Obj>(source.projected);
  const projected = oldProjected.filter((item) => item.kind !== 'fit').map((item) => ({ ...item }));
  const projectedFits = oldProjected.filter((item) => item.kind === 'fit' && typeof item.fit_id === 'string')
    .map((item) => ({
      fit_id: item.fit_id as string,
      amount: typeof item.amount === 'number' ? item.amount : 1,
      distance_m: typeof item.distance_m === 'number' ? item.distance_m : null,
    }));
  const environmentValue = source.environment;
  const environment = Array.isArray(environmentValue) ? environmentValue : object(environmentValue).effect_type_ids;
  const legacyNested: Obj = {};
  const fleetUnknown = omit(fleet, ['booster_fit_ids', 'buffs']);
  const environmentUnknown = Array.isArray(environmentValue) ? {} : omit(object(environmentValue), ['effect_type_ids', 'system_security']);
  const optionsUnknown = omit(object(source.options), ['factor_reload', 'spool', 'rah']);
  if (Object.keys(fleetUnknown).length) legacyNested.fleet = fleetUnknown;
  if (Object.keys(environmentUnknown).length) legacyNested.environment = environmentUnknown;
  if (Object.keys(optionsUnknown).length) legacyNested.options = optionsUnknown;
  const fit = {
    ship: { type_id: Number(source.ship_type_id ?? 0), ...(source.mode_type_id !== undefined ? { mode_type_id: source.mode_type_id } : {}) },
    modules: list(source.modules),
    drones: list(source.drones),
    fighters: list(source.fighters),
    implants: list(source.implants),
    boosters: list(source.boosters),
    cargo: list(source.cargo),
    projected,
    fleet_buffs: list(fleet.buffs),
    environment: {
      effect_type_ids: list(environment),
      system_security: source.system_security ?? object(environmentValue).system_security ?? null,
    },
    overrides: list(source.overrides),
    options: { factor_reload: false, spool: 1, rah: 'adapt', ...object(source.options) },
  } as Fit;
  const doc: FitDocument = {
    format: 'exfa/fit@1',
    id: text(source.id, fallbackId),
    name: text(source.name, 'Untitled fit'),
    fit,
    refs: {
      character_id: text(source.character_id, 'all5'),
      damage_pattern_id: text(source.damage_pattern_id, 'uniform'),
      target_profile_id: text(source.target_profile_id, 'none'),
      scenario_ids: [],
    },
    links: {
      booster_fit_ids: list(fleet.booster_fit_ids),
      projected_fits: projectedFits,
    },
    alternatives: [],
    branches: [],
    history: [],
  };
  for (const key of ['notes', 'folder', 'tags', 'created', 'modified'] as const) {
    const item = source[key];
    if (item !== undefined) doc[key] = clone(item) as never;
  }
  const ui = withLegacyUi(source.ui, { ...omit(source, known), ...legacyNested });
  if (ui) doc.ui = ui;
  return doc;
}

function normalizeLibrary(source: Obj): Library {
  const fitsSource = record<unknown>(source.fits);
  return {
    ...source,
    format: 'exfa/library@1',
    folders: normalizedFolders(source.folders),
    fits: Object.fromEntries(Object.entries(fitsSource).map(([id, fit]) => [id, migrateFitDocument(fit, id)])),
    characters: record(source.characters),
    damage_patterns: record(source.damage_patterns),
    target_profiles: record(source.target_profiles),
    scenarios: record(source.scenarios),
    fleets: record(source.fleets),
    groups: record(source.groups),
  } as Library;
}

export function migrateLegacyLibrary(value: unknown): Library {
  const source = object(value);
  if (!source.fits || typeof source.fits !== 'object' || Array.isArray(source.fits)) {
    throw new FormatError('INVALID_LIBRARY', 'Legacy library must contain a fits map');
  }
  const known = ['format', 'fits', 'characters', 'damagePatterns', 'damage_patterns', 'targetProfiles', 'target_profiles', 'folders', 'scenarios', 'fleets', 'groups'];
  const library = normalizeLibrary({
    ...(source.ui !== undefined ? { ui: source.ui } : {}),
    format: 'exfa/library@1',
    fits: source.fits,
    folders: source.folders,
    characters: source.characters ?? {},
    damage_patterns: source.damage_patterns ?? source.damagePatterns ?? {},
    target_profiles: source.target_profiles ?? source.targetProfiles ?? {},
    scenarios: source.scenarios ?? {},
    fleets: source.fleets ?? {},
    groups: source.groups ?? {},
  });
  const unknown = omit(source, known);
  if (Object.keys(unknown).length) {
    const ui = object(library.ui);
    library.ui = { ...ui, legacy: { ...object(ui.legacy), library: unknown } };
  }
  return library;
}

export function migrate(value: unknown): Library {
  const source = object(value);
  const format = source.format;
  if (format === 'exfa/library@1') {
    if (source.fits !== undefined && (source.fits === null || typeof source.fits !== 'object' || Array.isArray(source.fits))) {
      throw new FormatError('INVALID_LIBRARY', 'Library fits must be an object');
    }
    return normalizeLibrary(source);
  }
  if (typeof format === 'string' && /^exfa\/library@\d+$/.test(format)) {
    const version = Number(format.slice('exfa/library@'.length));
    if (version > 1) throw new FormatError('UNSUPPORTED_VERSION', `Unsupported library version: ${version}`);
    throw new FormatError('INVALID_LIBRARY', `Unsupported library format: ${format}`);
  }
  if (format === 'eve-fit-web-library') {
    const wrapper = omit(source, ['format', 'version', 'exported_at', 'implant_sets', 'lib']);
    const library = migrateLegacyLibrary(source.lib);
    const backup = { format, ...(source.version !== undefined ? { version: source.version } : {}),
      ...(source.exported_at !== undefined ? { exported_at: source.exported_at } : {}),
      ...(source.implant_sets !== undefined ? { implant_sets: source.implant_sets } : {}), ...wrapper };
    if (Object.keys(backup).length) {
      const ui = object(library.ui);
      library.ui = { ...ui, legacy: { ...object(ui.legacy), backup } };
    }
    return library;
  }
  if (source.fits && typeof source.fits === 'object' && !Array.isArray(source.fits)
    && Object.values(source.fits as Obj).some((fit) => Object.hasOwn(object(fit), 'ship_type_id'))) {
    return migrateLegacyLibrary(source);
  }
  throw new FormatError('INVALID_LIBRARY', 'Unrecognized library format');
}
