import { applyBranch } from './branches.js';
import { FormatError, type Fit, type FitDocument, type FitRequest, type FitRequestProjected, type FitRequestScenario, type Library, type ResolveContext, type ResolveOptions, type Scenario } from './types.js';

const clone = <T>(value: T): T => structuredClone(value);

function nestedFit(library: Library, id: string): FitRequest | null {
  const document = library.fits[id];
  return document ? resolveFit(document.fit, { library, depth: 1, document_id: document.id, refs: document.refs, links: document.links }) : null;
}

function scenarioTarget(library: Library, scenario: Scenario): Record<string, unknown> {
  const target = scenario.target;
  if (typeof target.profile_id === 'string') {
    const profile = library.target_profiles[target.profile_id];
    if (!profile) throw new FormatError('TARGET_PROFILE_NOT_FOUND', `Target profile not found: ${target.profile_id}`);
    return {
      profile: {
        em: profile.em, thermal: profile.thermal, kinetic: profile.kinetic, explosive: profile.explosive,
        max_velocity: profile.max_velocity ?? null, signature_radius: profile.signature_radius ?? null,
        radius: profile.radius ?? null, hp: profile.hp ?? null,
      },
    };
  }
  if (typeof target.fit_id === 'string') {
    const fit = nestedFit(library, target.fit_id);
    if (!fit) throw new FormatError('FIT_NOT_FOUND', `Scenario target fit not found: ${target.fit_id}`);
    return { fit, resist_mode: target.resist_mode ?? 'auto' };
  }
  return { profile: clone(target.profile) };
}

export function scenarioRequest(library: Library, scenario: Scenario): FitRequestScenario {
  const result: FitRequestScenario = { id: scenario.id, target: scenarioTarget(library, scenario) };
  const params = Object.fromEntries(Object.entries(scenario.params ?? {}).filter(([, value]) => value !== null && value !== undefined));
  if (Object.keys(params).length) result.params = params;
  if (scenario.settings) result.settings = clone(scenario.settings);
  return result;
}

function boosterFitIds(library: Library, links: FitDocument['links'], documentId?: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (id !== documentId && library.fits[id] && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  };
  for (const id of links.booster_fit_ids ?? []) add(id);
  if (documentId) {
    for (const [, fleet] of Object.entries(library.fleets).sort(([a], [b]) => a.localeCompare(b))) {
      if (!fleet.members.some((member) => member.fit_id === documentId)) continue;
      for (const member of fleet.members) if (member.role === 'command') add(member.fit_id);
    }
  }
  return ids;
}

function projectedRequest(library: Library, fit: Fit, links: FitDocument['links']): FitRequestProjected[] {
  const result: FitRequestProjected[] = [];
  for (const item of fit.projected) {
    const base = { amount: item.amount, distance_m: item.distance_m };
    if (item.kind === 'module') {
      result.push({ kind: 'module', module: { type_id: item.type_id, state: item.state ?? 'active', charge_type_id: item.charge_type_id ?? null }, ...base });
    } else if (item.kind === 'drone') {
      const quantity = item.quantity ?? 1;
      result.push({ kind: 'drone', drone: { type_id: item.type_id, quantity, active: quantity }, ...base });
    } else {
      result.push({ kind: 'fighter', fighter: { type_id: item.type_id, quantity: item.quantity ?? 1, active: true, abilities: null }, ...base });
    }
  }
  for (const link of links.projected_fits ?? []) {
    const nested = nestedFit(library, link.fit_id);
    if (nested) result.push({ kind: 'fit', fit: nested, amount: link.amount, distance_m: link.distance_m });
  }
  return result;
}

export function resolveFit(fit: Fit, context: ResolveContext): FitRequest {
  const { library } = context;
  const depth = context.depth ?? 0;
  const refs = context.refs ?? { character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', scenario_ids: [] };
  const links = context.links ?? { booster_fit_ids: [], projected_fits: [] };
  const character = library.characters[refs.character_id] ?? library.characters.all5;
  const result: FitRequest = {
    schema_version: 1,
    ship: { type_id: fit.ship.type_id, mode_type_id: fit.ship.mode_type_id ?? null },
    character: {
      skills: { default_level: character?.default_level ?? 5, levels: character?.levels ?? {} },
      security_status: character?.security_status ?? null,
      alpha_clone: character?.alpha_clone === true,
    },
    modules: fit.modules.map((module) => ({
      type_id: module.type_id,
      slot: module.slot,
      state: module.state,
      charge_type_id: module.charge_type_id ?? null,
      mutation: module.mutation ?? null,
      spool: module.spool != null ? { type: 'spool_scale', amount: module.spool } : null,
    })),
    drones: fit.drones.map((drone) => ({
      type_id: drone.type_id, quantity: drone.quantity, active: drone.active,
      ...(drone.mutation != null ? { mutation: clone(drone.mutation) } : {}),
    })),
    fighters: fit.fighters.map((fighter) => ({
      type_id: fighter.type_id, quantity: fighter.quantity, active: fighter.active, abilities: fighter.abilities ?? null,
    })),
    implants: clone(fit.implants),
    boosters: fit.boosters.map((booster) => ({ type_id: booster.type_id, side_effects: booster.side_effects ?? [] })),
    cargo: fit.cargo.map(({ type_id, quantity }) => ({ type_id, quantity })),
    fleet: {
      buffs: clone(fit.fleet_buffs),
      booster_fits: depth > 0 ? [] : boosterFitIds(library, links, context.document_id)
        .map((id) => nestedFit(library, id)).filter((value): value is FitRequest => value !== null),
    },
    projected: depth > 0 ? [] : projectedRequest(library, fit, links),
    environment: clone(fit.environment),
    damage_pattern: (() => {
      const pattern = library.damage_patterns[refs.damage_pattern_id];
      return pattern && pattern.id !== 'uniform'
        ? { em: pattern.em, thermal: pattern.thermal, kinetic: pattern.kinetic, explosive: pattern.explosive }
        : null;
    })(),
    target_profile: (() => {
      const profile = library.target_profiles[refs.target_profile_id];
      return profile && profile.id !== 'none'
        ? {
          em: profile.em, thermal: profile.thermal, kinetic: profile.kinetic, explosive: profile.explosive,
          signature_radius: profile.signature_radius ?? null, max_velocity: profile.max_velocity ?? null,
          radius: profile.radius ?? null,
        }
        : null;
    })(),
    overrides: clone(fit.overrides ?? []),
    options: {
      factor_reload: fit.options.factor_reload,
      default_spool: { type: 'spool_scale', amount: fit.options.spool },
      rah: fit.options.rah,
      include_attributes: 'none',
      sources: false,
      validate: true,
      cap_sim: { reload: false, stagger: false, max_time_s: null },
    },
  };
  const scenarioIds = refs.scenario_ids ?? [];
  if (depth === 0 && scenarioIds.length) {
    result.scenarios = scenarioIds.flatMap((id) => {
      const scenario = library.scenarios[id];
      return scenario ? [scenarioRequest(library, scenario)] : [];
    });
  }
  return result;
}

export function resolve(library: Library, fitId: string, options: ResolveOptions = {}): FitRequest {
  const original: FitDocument | undefined = library.fits[fitId];
  if (!original) throw new FormatError('FIT_NOT_FOUND', `Fit not found: ${fitId}`);
  const document = options.branch ? applyBranch(original, options.branch) : original;
  return resolveFit(document.fit, { library, depth: 0, document_id: document.id, refs: document.refs, links: document.links });
}
