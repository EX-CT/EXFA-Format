use crate::types::{Character, DamagePattern, FitDocument, Fleet, Group, Library, Package, PackageRoot, PackageRootKind, Scenario, TargetProfile};
use crate::util::uid;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Default)]
struct Closure {
    fits: BTreeMap<String, FitDocument>,
    characters: BTreeMap<String, Character>,
    damage_patterns: BTreeMap<String, DamagePattern>,
    target_profiles: BTreeMap<String, TargetProfile>,
    scenarios: BTreeMap<String, Scenario>,
    groups: BTreeMap<String, Group>,
}

fn collect_scenario(library: &Library, scenario: &Scenario, out: &mut Closure) {
    if out.scenarios.contains_key(&scenario.id) {
        return;
    }
    out.scenarios.insert(scenario.id.clone(), scenario.clone());
    if let Some(profile_id) = scenario.target.get("profile_id").and_then(Value::as_str) {
        if let Some(profile) = library.target_profiles.get(profile_id) {
            out.target_profiles.insert(profile_id.to_owned(), profile.clone());
        }
    }
    if let Some(fit_id) = scenario.target.get("fit_id").and_then(Value::as_str) {
        if let Some(doc) = library.fits.get(fit_id) {
            collect_fit(library, doc, out);
        }
    }
}

fn collect_fit(library: &Library, document: &FitDocument, out: &mut Closure) {
    if out.fits.contains_key(&document.id) {
        return;
    }
    out.fits.insert(document.id.clone(), document.clone());
    if let Some(character) = library.characters.get(&document.refs.character_id) {
        out.characters.insert(document.refs.character_id.clone(), character.clone());
    }
    if let Some(pattern) = library.damage_patterns.get(&document.refs.damage_pattern_id) {
        out.damage_patterns.insert(document.refs.damage_pattern_id.clone(), pattern.clone());
    }
    if let Some(profile) = library.target_profiles.get(&document.refs.target_profile_id) {
        out.target_profiles.insert(document.refs.target_profile_id.clone(), profile.clone());
    }
    for id in &document.refs.scenario_ids {
        if let Some(scenario) = library.scenarios.get(id) {
            collect_scenario(library, scenario, out);
        }
    }
    for id in &document.links.booster_fit_ids {
        if let Some(linked) = library.fits.get(id) {
            collect_fit(library, linked, out);
        }
    }
    for link in &document.links.projected_fits {
        if let Some(linked) = library.fits.get(&link.fit_id) {
            collect_fit(library, linked, out);
        }
    }
}

fn closure_library(library: &Library, out: Closure) -> Library {
    let mut used_folders = HashSet::new();
    for document in out.fits.values() {
        if let Some(folder) = &document.folder {
            used_folders.insert(folder.clone());
        }
    }
    for group in out.groups.values() {
        if let Some(folder) = &group.folder {
            used_folders.insert(folder.clone());
        }
    }
    Library {
        format: "exfa/library@1".to_owned(),
        folders: library.folders.iter().filter(|folder| used_folders.contains(*folder)).cloned().collect(),
        fits: out.fits,
        characters: out.characters,
        damage_patterns: out.damage_patterns,
        target_profiles: out.target_profiles,
        scenarios: out.scenarios,
        fleets: BTreeMap::new(),
        groups: out.groups,
        extra: BTreeMap::new(),
    }
}

/// Packages a single fit document plus its transitive reference/link closure into an `exfa/package@1`.
pub fn package_fit(library: &Library, document: &FitDocument) -> Package {
    let mut out = Closure::default();
    collect_fit(library, document, &mut out);
    Package {
        format: "exfa/package@1".to_owned(),
        root: PackageRoot { kind: PackageRootKind::Fit, id: document.id.clone(), extra: BTreeMap::new() },
        library: closure_library(library, out),
        extra: BTreeMap::new(),
    }
}

/// Packages a group plus every actor's fit document (and their closures) into an `exfa/package@1`.
pub fn package_group(library: &Library, group: &Group) -> Package {
    let mut out = Closure::default();
    for actor in &group.actors {
        if let Some(document) = library.fits.get(&actor.fit_id) {
            collect_fit(library, document, &mut out);
        }
    }
    out.groups.insert(group.id.clone(), group.clone());
    Package {
        format: "exfa/package@1".to_owned(),
        root: PackageRoot { kind: PackageRootKind::Group, id: group.id.clone(), extra: BTreeMap::new() },
        library: closure_library(library, out),
        extra: BTreeMap::new(),
    }
}

// ------------------------------------------------------------------ merge

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConflictPolicy {
    #[default]
    Rename,
    Replace,
    Skip,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MergePolicy {
    pub on_conflict: ConflictPolicy,
}

const MAP_KEYS: [(&str, &str); 7] = [
    ("characters", "character"),
    ("damage_patterns", "damage_pattern"),
    ("target_profiles", "target_profile"),
    ("scenarios", "scenario"),
    ("fleets", "fleet"),
    ("groups", "group"),
    ("fits", "fit"),
];

fn map_label(key: &str) -> &'static str {
    MAP_KEYS.iter().find(|(candidate, _)| *candidate == key).map(|(_, label)| *label).unwrap_or("entry")
}

fn incoming_entities(library: &Library, key: &str) -> Vec<(String, Value)> {
    macro_rules! collect {
        ($map:expr) => {
            $map.iter().map(|(id, entity)| (id.clone(), serde_json::to_value(entity).unwrap_or(Value::Null))).collect()
        };
    }
    match key {
        "fits" => collect!(library.fits),
        "characters" => collect!(library.characters),
        "damage_patterns" => collect!(library.damage_patterns),
        "target_profiles" => collect!(library.target_profiles),
        "scenarios" => collect!(library.scenarios),
        "fleets" => collect!(library.fleets),
        "groups" => collect!(library.groups),
        _ => Vec::new(),
    }
}

fn existing_value(target: &Library, key: &str, id: &str) -> Option<Value> {
    macro_rules! find {
        ($map:expr) => {
            $map.get(id).map(|entity| serde_json::to_value(entity).unwrap_or(Value::Null))
        };
    }
    match key {
        "fits" => find!(target.fits),
        "characters" => find!(target.characters),
        "damage_patterns" => find!(target.damage_patterns),
        "target_profiles" => find!(target.target_profiles),
        "scenarios" => find!(target.scenarios),
        "fleets" => find!(target.fleets),
        "groups" => find!(target.groups),
        _ => None,
    }
}

fn map_contains(target: &Library, key: &str, id: &str) -> bool {
    match key {
        "fits" => target.fits.contains_key(id),
        "characters" => target.characters.contains_key(id),
        "damage_patterns" => target.damage_patterns.contains_key(id),
        "target_profiles" => target.target_profiles.contains_key(id),
        "scenarios" => target.scenarios.contains_key(id),
        "fleets" => target.fleets.contains_key(id),
        "groups" => target.groups.contains_key(id),
        _ => false,
    }
}

fn insert_entity(target: &mut Library, key: &str, id: &str, entity: Value, issues: &mut Vec<String>) {
    macro_rules! put {
        ($map:expr, $ty:ty) => {
            match serde_json::from_value::<$ty>(entity) {
                Ok(value) => {
                    $map.insert(id.to_owned(), value);
                }
                Err(error) => issues.push(format!("{} '{id}': invalid entry: {error}", map_label(key))),
            }
        };
    }
    match key {
        "fits" => put!(target.fits, FitDocument),
        "characters" => put!(target.characters, Character),
        "damage_patterns" => put!(target.damage_patterns, DamagePattern),
        "target_profiles" => put!(target.target_profiles, TargetProfile),
        "scenarios" => put!(target.scenarios, Scenario),
        "fleets" => put!(target.fleets, Fleet),
        "groups" => put!(target.groups, Group),
        _ => {}
    }
}

fn remap_str(value: &mut Value, renames: &HashMap<String, String>) {
    if let Some(id) = value.as_str() {
        if let Some(new_id) = renames.get(id) {
            *value = Value::String(new_id.clone());
        }
    }
}

fn remap_list(value: &mut Value, renames: &HashMap<String, String>) {
    if let Some(items) = value.as_array_mut() {
        for item in items {
            remap_str(item, renames);
        }
    }
}

fn remap_entity(key: &str, entity: &mut Value, renames: &HashMap<String, HashMap<String, String>>) {
    let empty = HashMap::new();
    let get = |category: &str| renames.get(category).unwrap_or(&empty);
    match key {
        "fits" => {
            if let Some(refs) = entity.get_mut("refs").and_then(Value::as_object_mut) {
                for (field, category) in [("character_id", "characters"), ("damage_pattern_id", "damage_patterns"), ("target_profile_id", "target_profiles")] {
                    if let Some(value) = refs.get_mut(field) {
                        remap_str(value, get(category));
                    }
                }
                if let Some(value) = refs.get_mut("scenario_ids") {
                    remap_list(value, get("scenarios"));
                }
            }
            if let Some(links) = entity.get_mut("links").and_then(Value::as_object_mut) {
                if let Some(value) = links.get_mut("booster_fit_ids") {
                    remap_list(value, get("fits"));
                }
                if let Some(list) = links.get_mut("projected_fits").and_then(Value::as_array_mut) {
                    for link in list {
                        if let Some(value) = link.get_mut("fit_id") {
                            remap_str(value, get("fits"));
                        }
                    }
                }
            }
        }
        "scenarios" => {
            if let Some(target) = entity.get_mut("target").and_then(Value::as_object_mut) {
                if let Some(value) = target.get_mut("profile_id") {
                    remap_str(value, get("target_profiles"));
                }
                if let Some(value) = target.get_mut("fit_id") {
                    remap_str(value, get("fits"));
                }
            }
        }
        "groups" => {
            if let Some(actors) = entity.get_mut("actors").and_then(Value::as_array_mut) {
                for actor in actors {
                    if let Some(value) = actor.get_mut("fit_id") {
                        remap_str(value, get("fits"));
                    }
                }
            }
        }
        "fleets" => {
            if let Some(members) = entity.get_mut("members").and_then(Value::as_array_mut) {
                for member in members {
                    if let Some(value) = member.get_mut("fit_id") {
                        remap_str(value, get("fits"));
                    }
                }
            }
        }
        _ => {}
    }
}

fn dangling_issues(key: &str, id: &str, entity: &Value, target: &Library, issues: &mut Vec<String>) {
    let label = map_label(key);
    macro_rules! check {
        ($category:literal, $value:expr, $field:literal) => {
            if let Some(ref_id) = ($value as Option<&Value>).and_then(|value| value.as_str()) {
                if !ref_id.is_empty() && !map_contains(target, $category, ref_id) {
                    issues.push(format!("{label} '{id}': dangling {} reference '{ref_id}'", $field));
                }
            }
        };
    }
    match key {
        "fits" => {
            let refs = entity.get("refs");
            check!("characters", refs.and_then(|value| value.get("character_id")), "character_id");
            check!("damage_patterns", refs.and_then(|value| value.get("damage_pattern_id")), "damage_pattern_id");
            check!("target_profiles", refs.and_then(|value| value.get("target_profile_id")), "target_profile_id");
            let empty = Vec::new();
            let scenario_ids = refs.and_then(|value| value.get("scenario_ids")).and_then(Value::as_array).unwrap_or(&empty);
            for value in scenario_ids {
                check!("scenarios", Some(value), "scenario_ids");
            }
            let links = entity.get("links");
            let booster_ids = links.and_then(|value| value.get("booster_fit_ids")).and_then(Value::as_array).unwrap_or(&empty);
            for value in booster_ids {
                check!("fits", Some(value), "booster_fit_ids");
            }
            let projected = links.and_then(|value| value.get("projected_fits")).and_then(Value::as_array).unwrap_or(&empty);
            for link in projected {
                check!("fits", link.get("fit_id"), "projected_fits");
            }
        }
        "scenarios" => {
            let scenario_target = entity.get("target");
            check!("target_profiles", scenario_target.and_then(|value| value.get("profile_id")), "profile_id");
            check!("fits", scenario_target.and_then(|value| value.get("fit_id")), "fit_id");
        }
        "groups" => {
            let empty = Vec::new();
            let actors = entity.get("actors").and_then(Value::as_array).unwrap_or(&empty);
            for actor in actors {
                check!("fits", actor.get("fit_id"), "fit_id");
            }
        }
        "fleets" => {
            let empty = Vec::new();
            let members = entity.get("members").and_then(Value::as_array).unwrap_or(&empty);
            for member in members {
                check!("fits", member.get("fit_id"), "fit_id");
            }
        }
        _ => {}
    }
}

/// Merges a package's dependency closure into a target library. `Rename` (default) mints `imp-*` ids for
/// colliding entries with different content and remaps references inside imported entities; `Replace`
/// overwrites; `Skip` keeps the existing entry. Identical entries are not conflicts. Returns human-readable
/// issues for conflicts and references that stay dangling after the merge.
pub fn merge_package(target: &mut Library, package: &Package, policy: MergePolicy) -> Vec<String> {
    let mut issues = Vec::new();
    let mut renames: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut placements: Vec<(String, String, Value)> = Vec::new();
    for (key, label) in MAP_KEYS {
        for (id, entity) in incoming_entities(&package.library, key) {
            match existing_value(target, key, &id) {
                None => placements.push((key.to_owned(), id, entity)),
                Some(existing) if existing == entity => {}
                Some(_) => match policy.on_conflict {
                    ConflictPolicy::Skip => issues.push(format!("{label} '{id}': conflict, kept existing")),
                    ConflictPolicy::Replace => {
                        issues.push(format!("{label} '{id}': conflict, replaced existing"));
                        placements.push((key.to_owned(), id, entity));
                    }
                    ConflictPolicy::Rename => {
                        let mut new_id = format!("imp-{}", uid());
                        while existing_value(target, key, &new_id).is_some()
                            || renames.get(key).is_some_and(|map| map.values().any(|value| value == &new_id))
                        {
                            new_id = format!("imp-{}", uid());
                        }
                        renames.entry(key.to_owned()).or_default().insert(id.clone(), new_id.clone());
                        placements.push((key.to_owned(), id.clone(), entity));
                        issues.push(format!("{label} '{id}': conflict, renamed to '{new_id}'"));
                    }
                },
            }
        }
    }

    let mut merged: Vec<(String, String, Value)> = Vec::new();
    for (key, source_id, mut entity) in placements {
        remap_entity(&key, &mut entity, &renames);
        let id = renames.get(&key).and_then(|map| map.get(&source_id)).cloned().unwrap_or(source_id);
        if let Some(object) = entity.as_object_mut() {
            object.insert("id".to_owned(), json!(id));
        }
        insert_entity(target, &key, &id, entity.clone(), &mut issues);
        merged.push((key, id, entity));
    }
    for folder in &package.library.folders {
        if !target.folders.contains(folder) {
            target.folders.push(folder.clone());
        }
    }
    for (key, id, entity) in &merged {
        dangling_issues(key, id, entity, target, &mut issues);
    }
    issues
}
