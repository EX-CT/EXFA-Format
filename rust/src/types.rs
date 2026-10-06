use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Presence<T> {
    Missing,
    Null,
    Value(T),
}

impl<T> Default for Presence<T> {
    fn default() -> Self {
        Self::Missing
    }
}

impl<T> Presence<T> {
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }

    pub fn as_ref(&self) -> Option<&T> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }
}

impl<T: Serialize> Serialize for Presence<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing | Self::Null => serializer.serialize_none(),
            Self::Value(value) => value.serialize(serializer),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Presence<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    High,
    Mid,
    Low,
    Rig,
    Subsystem,
    Service,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModState {
    Offline,
    Online,
    Active,
    Overheated,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Security {
    Hisec,
    Lowsec,
    Nullsec,
    Wspace,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct SdeRef {
    pub build: u64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub dataset_revision: Presence<i64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Mutation {
    pub base_type_id: u64,
    pub mutaplasmid_type_id: u64,
    #[serde(default)]
    pub attributes: BTreeMap<String, f64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Ship {
    pub type_id: u64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub mode_type_id: Presence<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitModule {
    pub type_id: u64,
    pub slot: Option<Slot>,
    pub state: Option<ModState>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub charge_type_id: Presence<u64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub mutation: Presence<Mutation>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub spool: Presence<f64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub group: Presence<i64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub alt_id: Presence<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitDrone {
    pub type_id: u64,
    pub quantity: u64,
    pub active: u64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub mutation: Presence<Mutation>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub alt_id: Presence<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitFighter {
    pub type_id: u64,
    pub quantity: u64,
    pub active: bool,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub abilities: Presence<Vec<i64>>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitCargo {
    pub type_id: u64,
    pub quantity: u64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub alt_id: Presence<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ProjectedItem {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub state: Presence<ModState>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub charge_type_id: Presence<u64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub quantity: Presence<u64>,
    pub amount: f64,
    pub distance_m: Option<f64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FleetBuff {
    pub buff_id: i64,
    pub value: f64,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Environment {
    #[serde(default)]
    pub effect_type_ids: Vec<u64>,
    #[serde(default)]
    pub system_security: Option<Security>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Override {
    pub type_id: u64,
    pub attribute_id: i64,
    pub value: f64,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FitOptions {
    #[serde(default)]
    pub factor_reload: bool,
    #[serde(default = "default_spool")]
    pub spool: f64,
    #[serde(default = "default_rah")]
    pub rah: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for FitOptions {
    fn default() -> Self {
        Self { factor_reload: false, spool: 1.0, rah: default_rah(), extra: BTreeMap::new() }
    }
}

fn default_spool() -> f64 {
    1.0
}
fn default_rah() -> String {
    "adapt".to_owned()
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Fit {
    #[serde(default)]
    pub ship: Ship,
    #[serde(default)]
    pub modules: Vec<FitModule>,
    #[serde(default)]
    pub drones: Vec<FitDrone>,
    #[serde(default)]
    pub fighters: Vec<FitFighter>,
    #[serde(default)]
    pub implants: Vec<u64>,
    #[serde(default)]
    pub boosters: Vec<Value>,
    #[serde(default)]
    pub cargo: Vec<FitCargo>,
    #[serde(default)]
    pub projected: Vec<ProjectedItem>,
    #[serde(default)]
    pub fleet_buffs: Vec<FleetBuff>,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub overrides: Vec<Override>,
    #[serde(default)]
    pub options: FitOptions,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct AlternativeOption {
    pub type_id: u64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub charge_type_id: Presence<u64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub quantity: Presence<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Alternative {
    pub id: String,
    #[serde(default)]
    pub options: Vec<AlternativeOption>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Branch {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default)]
    pub picks: BTreeMap<String, usize>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct HistoryEntry {
    pub at: String,
    pub fit: Fit,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitRefs {
    pub character_id: String,
    pub damage_pattern_id: String,
    pub target_profile_id: String,
    #[serde(default)]
    pub scenario_ids: Vec<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ProjectedFitLink {
    pub fit_id: String,
    pub amount: f64,
    pub distance_m: Option<f64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitLinks {
    #[serde(default)]
    pub booster_fit_ids: Vec<String>,
    #[serde(default)]
    pub projected_fits: Vec<ProjectedFitLink>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FitDocument {
    pub format: String,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sde: Option<SdeRef>,
    #[serde(default)]
    pub fit: Fit,
    #[serde(default)]
    pub refs: FitRefs,
    #[serde(default)]
    pub links: FitLinks,
    #[serde(default)]
    pub alternatives: Vec<Alternative>,
    #[serde(default)]
    pub branches: Vec<Branch>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub active_branch: Presence<String>,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub default_level: u8,
    #[serde(default)]
    pub levels: BTreeMap<String, u8>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub security_status: Presence<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha_clone: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub esi: Option<Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct DamagePattern {
    pub id: String,
    pub name: String,
    pub em: f64,
    pub thermal: f64,
    pub kinetic: f64,
    pub explosive: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct TargetProfile {
    pub id: String,
    pub name: String,
    pub em: f64,
    pub thermal: f64,
    pub kinetic: f64,
    pub explosive: f64,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub signature_radius: Presence<f64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub max_velocity: Presence<f64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub radius: Presence<f64>,
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub hp: Presence<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Scenario {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    pub target: Value,
    #[serde(default)]
    pub params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct FleetMember {
    pub fit_id: String,
    pub role: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Fleet {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub members: Vec<FleetMember>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Library {
    pub format: String,
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub fits: BTreeMap<String, FitDocument>,
    #[serde(default)]
    pub characters: BTreeMap<String, Character>,
    #[serde(default)]
    pub damage_patterns: BTreeMap<String, DamagePattern>,
    #[serde(default)]
    pub target_profiles: BTreeMap<String, TargetProfile>,
    #[serde(default)]
    pub scenarios: BTreeMap<String, Scenario>,
    #[serde(default)]
    pub fleets: BTreeMap<String, Fleet>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
