export type Slot = 'high' | 'mid' | 'low' | 'rig' | 'subsystem' | 'service';
export type ModState = 'offline' | 'online' | 'active' | 'overheated';
export type Security = 'hisec' | 'lowsec' | 'nullsec' | 'wspace';
export type JsonObject = Record<string, unknown>;

export interface SdeRef extends JsonObject { build: number; dataset_revision?: number | null }
export interface Mutation extends JsonObject { base_type_id: number; mutaplasmid_type_id: number; attributes: Record<string, number> }
export interface FitModule extends JsonObject {
  id?: string; type_id: number; slot: Slot; state: ModState; charge_type_id?: number | null; mutation?: Mutation | null;
  spool?: number | null; group?: number | null; alt_id?: string | null;
}
export interface FitDrone extends JsonObject { id?: string; type_id: number; quantity: number; active: number; mutation?: Mutation | null; alt_id?: string | null }
export interface FitFighter extends JsonObject { id?: string; type_id: number; quantity: number; active: boolean; abilities?: number[] | null }
export interface FitCargo extends JsonObject { id?: string; type_id: number; quantity: number; alt_id?: string | null }
export type ProjectedItem =
  | ({ kind: 'module'; type_id: number; state?: ModState; charge_type_id?: number | null; amount: number; distance_m: number | null } & JsonObject)
  | ({ kind: 'drone' | 'fighter'; type_id: number; quantity?: number; amount: number; distance_m: number | null } & JsonObject);
export interface Fit {
  ship: { type_id: number; mode_type_id?: number | null; [key: string]: unknown };
  modules: FitModule[];
  drones: FitDrone[];
  fighters: FitFighter[];
  implants: number[];
  boosters: { type_id: number; side_effects?: number[]; [key: string]: unknown }[];
  cargo: FitCargo[];
  projected: ProjectedItem[];
  fleet_buffs: { buff_id: number; value: number; [key: string]: unknown }[];
  environment: { effect_type_ids: number[]; system_security: Security | null; [key: string]: unknown };
  overrides?: { type_id: number; attribute_id: number; value: number; [key: string]: unknown }[];
  options: { factor_reload: boolean; spool: number; rah: 'adapt' | 'disable'; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AlternativeOption extends JsonObject { type_id: number; charge_type_id?: number | null; quantity?: number | null }
export interface Alternative extends JsonObject { id: string; options: AlternativeOption[] }
export interface Branch extends JsonObject { id: string; name: string; note?: string; picks: Record<string, number> }
export interface HistoryEntry extends JsonObject { at: string; fit: Fit; note?: string }

export interface FitDocument extends JsonObject {
  format: 'exfa/fit@1';
  id: string;
  name: string;
  notes?: string;
  tags?: string[];
  folder?: string;
  created?: string;
  modified?: string;
  sde?: SdeRef;
  fit: Fit;
  refs: { character_id: string; damage_pattern_id: string; target_profile_id: string; scenario_ids: string[]; [key: string]: unknown };
  links: { booster_fit_ids: string[]; projected_fits: { fit_id: string; amount: number; distance_m: number | null; [key: string]: unknown }[]; [key: string]: unknown };
  alternatives: Alternative[];
  branches: Branch[];
  active_branch?: string | null;
  history: HistoryEntry[];
  ui?: Record<string, unknown>;
}

export interface Character extends JsonObject {
  id: string; name: string; default_level: number; levels: Record<string, number>;
  security_status?: number | null; alpha_clone?: boolean; builtin?: boolean; esi?: Record<string, unknown>;
}
export interface DamagePattern extends JsonObject { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number; builtin?: boolean }
export interface TargetProfile extends JsonObject {
  id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number;
  signature_radius?: number | null; max_velocity?: number | null; radius?: number | null; hp?: number | null; builtin?: boolean;
}
export type ScenarioTarget =
  | { profile_id: string; [key: string]: unknown }
  | { fit_id: string; resist_mode?: 'auto' | 'shield' | 'armor' | 'hull' | 'weighted_average'; [key: string]: unknown }
  | { profile: Omit<TargetProfile, 'id' | 'name' | 'builtin'>; [key: string]: unknown };
export interface Scenario extends JsonObject {
  id: string; name: string; builtin?: boolean; target: ScenarioTarget;
  params: {
    distance_m?: number | null; time_s?: number | null; tgt_speed_mps?: number | null; tgt_speed_pct?: number | null;
    tgt_sig_m?: number | null; atk_speed_mps?: number | null; atk_speed_pct?: number | null;
    atk_angle_deg?: number | null; tgt_angle_deg?: number | null; [key: string]: unknown;
  };
  settings?: {
    ignore_resists?: boolean; apply_projected?: boolean; ignore_lock_range?: boolean; ignore_drone_control_range?: boolean;
    mobile_drone_mode?: 'auto' | 'follow_attacker' | 'follow_target'; [key: string]: unknown;
  };
}
export interface Fleet extends JsonObject {
  id: string; name: string; folder?: string; notes?: string;
  members: { fit_id: string; role: 'command' | 'member'; [key: string]: unknown }[];
}
export type GroupRelationKind = 'project' | 'command';
export interface GroupActor extends JsonObject { id: string; fit_id: string; label?: string; role?: string }
export interface GroupRelation extends JsonObject {
  id: string; kind: GroupRelationKind;
  source: string;             // actor id
  targets: string[];          // actor ids
  source_item_ids?: string[]; // ids of modules/drones/fighters inside the source fit document
  amount?: number; distance_m?: number | null; enabled?: boolean; notes?: string;
}
export interface Group extends JsonObject {
  format: 'exfa/group@1'; id: string; name: string;
  folder?: string; notes?: string;
  actors: GroupActor[]; relations: GroupRelation[];
}
export interface Package extends JsonObject {
  format: 'exfa/package@1';
  root: { kind: 'fit' | 'group'; id: string };
  library: Library;          // dependency closure only
}
export interface Workspace extends JsonObject {
  format: 'exfa/workspace@1'; id: string; name: string; notes?: string;
  defaults: Record<string, unknown>;  // host-defined default scope keys
  library: Library;
}
export interface Library extends JsonObject {
  format: 'exfa/library@1';
  folders: string[];
  fits: Record<string, FitDocument>;
  characters: Record<string, Character>;
  damage_patterns: Record<string, DamagePattern>;
  target_profiles: Record<string, TargetProfile>;
  scenarios: Record<string, Scenario>;
  fleets: Record<string, Fleet>;
  groups: Record<string, Group>;
}
export interface FitRequestScenario extends JsonObject {
  id: string;
  target: JsonObject;
  params?: JsonObject;
  settings?: JsonObject;
}
export interface FitRequestModule {
  id?: string;
  type_id: number;
  slot: Slot;
  state: ModState;
  charge_type_id: number | null;
  mutation: Mutation | null;
  spool: { type: 'spool_scale'; amount: number } | null;
}
export interface ProjectedFitSelect { module_ids?: string[]; drone_ids?: string[]; fighter_ids?: string[] }
export type FitRequestProjected =
  | { kind: 'module'; module: { type_id: number; state: ModState; charge_type_id: number | null }; amount: number; distance_m: number | null }
  | { kind: 'drone'; drone: { type_id: number; quantity: number; active: number }; amount: number; distance_m: number | null }
  | { kind: 'fighter'; fighter: { type_id: number; quantity: number; active: true; abilities: null }; amount: number; distance_m: number | null }
  | { kind: 'fit'; fit: FitRequest; amount: number; distance_m: number | null; select?: ProjectedFitSelect };
export interface FitRequest extends JsonObject {
  schema_version: 1;
  ship: { type_id: number; mode_type_id: number | null };
  character: {
    skills: { default_level: number; levels: Record<string, number> };
    security_status: number | null;
    alpha_clone: boolean;
  };
  modules: FitRequestModule[];
  drones: { id?: string; type_id: number; quantity: number; active: number; mutation?: Mutation }[];
  fighters: { id?: string; type_id: number; quantity: number; active: boolean; abilities: number[] | null }[];
  implants: number[];
  boosters: { type_id: number; side_effects: number[] }[];
  cargo: { id?: string; type_id: number; quantity: number }[];
  fleet: { buffs: { buff_id: number; value: number }[]; booster_fits: FitRequest[] };
  projected: FitRequestProjected[];
  environment: { effect_type_ids: number[]; system_security: Security | null };
  damage_pattern: Pick<DamagePattern, 'em' | 'thermal' | 'kinetic' | 'explosive'> | null;
  target_profile: Pick<TargetProfile, 'em' | 'thermal' | 'kinetic' | 'explosive' | 'signature_radius' | 'max_velocity' | 'radius'> | null;
  overrides: { type_id: number; attribute_id: number; value: number }[];
  options: {
    factor_reload: boolean;
    default_spool: { type: 'spool_scale'; amount: number };
    rah: 'adapt' | 'disable';
    include_attributes: 'none';
    sources: false;
    validate: true;
    cap_sim: { reload: false; stagger: false; max_time_s: null };
  };
  scenarios?: FitRequestScenario[];
}
export interface ResolveContext { library: Library; depth?: number; document_id?: string; refs?: FitDocument['refs']; links?: FitDocument['links'] }
export interface ResolveOptions { branch?: string | null }

export class FormatError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = 'FormatError';
  }
}
