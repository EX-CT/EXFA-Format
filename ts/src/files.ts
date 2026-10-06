import { FormatError, type FitDocument, type Library } from './types.js';
import { migrateFitDocument } from './migrate.js';

export interface FormatFile { path: string; text: string }

const INDEX_PATH = 'library.exfa.json';
const DOC_ORDER = ['format', 'id', 'name', 'notes', 'tags', 'created', 'modified', 'sde', 'fit', 'refs', 'links', 'alternatives', 'branches', 'active_branch', 'history', 'ui'];
const FIELD_ORDER: Record<string, string[]> = {
  libraryIndex: ['format', 'folders', 'characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets'],
  fitDocument: DOC_ORDER,
  fit: ['ship', 'modules', 'drones', 'fighters', 'implants', 'boosters', 'cargo', 'projected', 'fleet_buffs', 'environment', 'overrides', 'options'],
  ship: ['type_id', 'mode_type_id'],
  mutation: ['base_type_id', 'mutaplasmid_type_id', 'attributes'],
  refs: ['character_id', 'damage_pattern_id', 'target_profile_id', 'scenario_ids'],
  links: ['booster_fit_ids', 'projected_fits'],
  projected_fits: ['fit_id', 'amount', 'distance_m'],
  alternatives: ['id', 'options'],
  alternativeOptions: ['type_id', 'charge_type_id', 'quantity'],
  branches: ['id', 'name', 'note', 'picks'],
  history: ['at', 'fit', 'note'],
  fitOptions: ['factor_reload', 'spool', 'rah'],
  character: ['id', 'name', 'default_level', 'levels', 'security_status', 'alpha_clone', 'builtin', 'esi'],
  damagePattern: ['id', 'name', 'em', 'thermal', 'kinetic', 'explosive', 'builtin'],
  targetProfile: ['id', 'name', 'em', 'thermal', 'kinetic', 'explosive', 'signature_radius', 'max_velocity', 'radius', 'hp', 'builtin'],
  scenario: ['id', 'name', 'builtin', 'target', 'params', 'settings'],
  fleet: ['id', 'name', 'folder', 'notes', 'members'],
  modules: ['type_id', 'slot', 'state', 'charge_type_id', 'mutation', 'spool', 'group', 'alt_id'],
  drones: ['type_id', 'quantity', 'active', 'mutation', 'alt_id'],
  fighters: ['type_id', 'quantity', 'active', 'abilities'],
  boosters: ['type_id', 'side_effects'],
  cargo: ['type_id', 'quantity', 'alt_id'],
  projected: ['kind', 'type_id', 'state', 'charge_type_id', 'quantity', 'amount', 'distance_m'],
  fleet_buffs: ['buff_id', 'value'],
  environment: ['effect_type_ids', 'system_security'],
  overrides: ['type_id', 'attribute_id', 'value'],
  params: ['distance_m', 'time_s', 'tgt_speed_mps', 'tgt_speed_pct', 'tgt_sig_m', 'atk_speed_mps', 'atk_speed_pct', 'atk_angle_deg', 'tgt_angle_deg'],
  settings: ['ignore_resists', 'apply_projected', 'ignore_lock_range', 'ignore_drone_control_range', 'mobile_drone_mode'],
  members: ['fit_id', 'role'],
};

function stable(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, key));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const preferred = FIELD_ORDER[key] ?? [];
  const known = preferred.filter((item) => Object.hasOwn(source, item));
  const rest = Object.keys(source).filter((item) => !preferred.includes(item)).sort();
  const childKey = (item: string) => {
    if (key === 'libraryIndex' && ['characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets'].includes(item)) return item;
    if (key === 'fitDocument' && item === 'fit') return 'fit';
    if (key === 'fitDocument' && item === 'refs') return 'refs';
    if (key === 'fit' && item === 'options') return 'fitOptions';
    if (key === 'alternatives' && item === 'options') return 'alternativeOptions';
    return item;
  };
  return Object.fromEntries([...known, ...rest].map((item) => {
    const valueKey = key === 'libraryIndex' && ['characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets'].includes(item)
      ? 'mapValues'
      : item;
    if (valueKey === 'mapValues' && source[item] && typeof source[item] === 'object' && !Array.isArray(source[item])) {
      const entries = Object.entries(source[item] as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      const mapValueKey = item === 'damage_patterns' ? 'damagePattern'
        : item === 'target_profiles' ? 'targetProfile' : item === 'scenarios' ? 'scenario'
          : item === 'fleets' ? 'fleet' : 'character';
      const mapping = Object.fromEntries(entries.map(([id, entry]) => [id, stable(entry, mapValueKey)]));
      return [item, mapping];
    }
    const nextKey = childKey(item);
    return [item, stable(source[item], nextKey)];
  }));
}

function safeSegment(value: string, empty = 'fit'): string {
  const replaced = value.replace(/[\\/:\*?"<>|\u0000-\u001f\u007f]/g, '_').trim().slice(0, 80).trim();
  if (!replaced) return empty;
  if (replaced === '.' || replaced === '..') return replaced.replace(/\./g, '_');
  return replaced;
}

function safeFolder(folder: string | undefined): string {
  return (folder ?? '').split('/').map((part) => part.trim()).filter(Boolean).map((part) => safeSegment(part, '_')).join('/');
}

function safeId(id: string): string {
  return encodeURIComponent(id);
}

function json(value: unknown, key: string): string {
  return `${JSON.stringify(stable(value, key), null, 2)}\n`;
}

export function toFiles(library: Library): FormatFile[] {
  const known = ['format', 'folders', 'fits', 'characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets'];
  const index = {
    format: 'exfa/library-index@1',
    folders: [...new Set(library.folders.map((folder) => safeFolder(folder)).filter(Boolean))],
    characters: library.characters,
    damage_patterns: library.damage_patterns,
    target_profiles: library.target_profiles,
    scenarios: library.scenarios,
    fleets: library.fleets,
    ...Object.fromEntries(Object.entries(library).filter(([key]) => !known.includes(key)).sort(([a], [b]) => a.localeCompare(b))),
  };
  const files: FormatFile[] = [{ path: INDEX_PATH, text: json(index, 'libraryIndex') }];
  for (const document of Object.values(library.fits).sort((a, b) => {
    const left = `${safeFolder(a.folder)}/${safeSegment(a.name)}.${safeId(a.id)}.exfa.json`;
    const right = `${safeFolder(b.folder)}/${safeSegment(b.name)}.${safeId(b.id)}.exfa.json`;
    return left.localeCompare(right);
  })) {
    const folder = safeFolder(document.folder);
    const path = `${folder ? `${folder}/` : ''}${safeSegment(document.name)}.${safeId(document.id)}.exfa.json`;
    const { folder: _folder, ...onDisk } = document;
    files.push({ path, text: json(onDisk, 'fitDocument') });
  }
  return files;
}

function cleanPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new FormatError('UNSAFE_PATH', `Unsafe format path: ${path}`);
  }
  return normalized;
}

export function fromFiles(files: FormatFile[]): Library {
  const result: Library = {
    format: 'exfa/library@1',
    folders: [],
    fits: {},
    characters: {},
    damage_patterns: {},
    target_profiles: {},
    scenarios: {},
    fleets: {},
  };
  const cleaned = files.map((file) => ({ ...file, path: cleanPath(file.path) }));
  const indexFile = cleaned.find((file) => file.path === INDEX_PATH);
  if (indexFile) {
    const index = JSON.parse(indexFile.text) as Record<string, unknown>;
    if (index.format !== 'exfa/library-index@1') throw new FormatError('INVALID_LIBRARY_INDEX', 'Invalid library index format');
    result.folders = [...new Set((Array.isArray(index.folders) ? index.folders : []).filter((x): x is string => typeof x === 'string')
      .map((folder) => folder.split('/').map((part) => part.trim()).filter(Boolean).join('/')).filter(Boolean))];
    result.characters = (index.characters && typeof index.characters === 'object' ? index.characters : {}) as Library['characters'];
    result.damage_patterns = (index.damage_patterns && typeof index.damage_patterns === 'object' ? index.damage_patterns : {}) as Library['damage_patterns'];
    result.target_profiles = (index.target_profiles && typeof index.target_profiles === 'object' ? index.target_profiles : {}) as Library['target_profiles'];
    result.scenarios = (index.scenarios && typeof index.scenarios === 'object' ? index.scenarios : {}) as Library['scenarios'];
    result.fleets = (index.fleets && typeof index.fleets === 'object' ? index.fleets : {}) as Library['fleets'];
    for (const [key, value] of Object.entries(index)) {
      if (!['format', 'folders', 'characters', 'damage_patterns', 'target_profiles', 'scenarios', 'fleets'].includes(key)) result[key] = value;
    }
  }
  for (const file of cleaned) {
    if (file.path === INDEX_PATH || !file.path.endsWith('.exfa.json')) continue;
    const raw = JSON.parse(file.text);
    const document = migrateFitDocument(raw) as FitDocument;
    if (!document.id) throw new FormatError('MISSING_FIT_ID', `Fit document in ${file.path} has no id`);
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    if (parent) document.folder = parent.split('/').map((part) => part.trim()).filter(Boolean).join('/');
    else delete document.folder;
    result.fits[document.id] = document;
  }
  return result;
}
