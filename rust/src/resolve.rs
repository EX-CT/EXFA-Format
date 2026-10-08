use crate::types::{AlternativeOption, FitDocument, Library, Presence, Scenario};
use crate::FormatError;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default)]
pub struct ResolveOptions {
    pub branch: Option<String>,
}

fn security_name(value: &Option<crate::types::Security>) -> Value {
    match value {
        Some(crate::types::Security::Hisec) => json!("hisec"),
        Some(crate::types::Security::Lowsec) => json!("lowsec"),
        Some(crate::types::Security::Nullsec) => json!("nullsec"),
        Some(crate::types::Security::Wspace) => json!("wspace"),
        None => Value::Null,
    }
}

fn profile_value(profile: &crate::types::TargetProfile) -> Value {
    json!({
        "em": profile.em,
        "thermal": profile.thermal,
        "kinetic": profile.kinetic,
        "explosive": profile.explosive,
        "signature_radius": profile.signature_radius,
        "max_velocity": profile.max_velocity,
        "radius": profile.radius,
    })
}

fn scenario_profile_value(profile: &crate::types::TargetProfile) -> Value {
    json!({
        "em": profile.em,
        "thermal": profile.thermal,
        "kinetic": profile.kinetic,
        "explosive": profile.explosive,
        "max_velocity": profile.max_velocity,
        "signature_radius": profile.signature_radius,
        "radius": profile.radius,
        "hp": profile.hp,
    })
}

fn scenario_target(library: &Library, scenario: &Scenario, depth: usize) -> Result<Value, FormatError> {
    let target = &scenario.target;
    if let Some(profile_id) = target.get("profile_id").and_then(Value::as_str) {
        let profile = library.target_profiles.get(profile_id).ok_or_else(|| {
            FormatError::new("TARGET_PROFILE_NOT_FOUND", format!("Target profile not found: {profile_id}"))
        })?;
        return Ok(json!({ "profile": scenario_profile_value(profile) }));
    }
    if let Some(fit_id) = target.get("fit_id").and_then(Value::as_str) {
        let document = library.fits.get(fit_id).ok_or_else(|| {
            FormatError::new("FIT_NOT_FOUND", format!("Scenario target fit not found: {fit_id}"))
        })?;
        let fit = resolve_fit(document, library, depth + 1)?;
        let resist_mode = target.get("resist_mode").filter(|value| !value.is_null()).cloned().unwrap_or(json!("auto"));
        return Ok(json!({ "fit": fit, "resist_mode": resist_mode }));
    }
    if let Some(profile) = target.get("profile") {
        return Ok(json!({ "profile": profile.clone() }));
    }
    Err(FormatError::new("INVALID_SCENARIO_TARGET", "Scenario target must reference a profile or fit"))
}

pub fn scenario_request(library: &Library, scenario: &Scenario) -> Result<Value, FormatError> {
    let mut request = Map::new();
    request.insert("id".to_owned(), json!(scenario.id));
    request.insert("target".to_owned(), scenario_target(library, scenario, 0)?);
    let params = scenario.params.as_object().map(|values| {
        values.iter().filter(|(_, value)| !value.is_null()).map(|(key, value)| (key.clone(), value.clone())).collect::<Map<_, _>>()
    }).unwrap_or_default();
    if !params.is_empty() {
        request.insert("params".to_owned(), Value::Object(params));
    }
    if let Some(settings) = &scenario.settings {
        request.insert("settings".to_owned(), settings.clone());
    }
    Ok(Value::Object(request))
}

fn apply_option(item: &mut Value, option: &AlternativeOption, list: &str) {
    if let Some(object) = item.as_object_mut() {
        object.insert("type_id".to_owned(), json!(option.type_id));
        if list == "modules" {
            match &option.charge_type_id {
                Presence::Missing => {}
                Presence::Null => { object.insert("charge_type_id".to_owned(), Value::Null); }
                Presence::Value(charge) => { object.insert("charge_type_id".to_owned(), json!(charge)); }
            }
        } else {
            match &option.quantity {
                Presence::Missing => {}
                Presence::Null => { object.insert("quantity".to_owned(), Value::Null); }
                Presence::Value(quantity) => { object.insert("quantity".to_owned(), json!(quantity)); }
            }
        }
    }
}

pub(crate) fn apply_branch(document: &FitDocument, branch_id: &str) -> Result<FitDocument, FormatError> {
    let branch = document.branches.iter().find(|branch| branch.id == branch_id).ok_or_else(|| {
        FormatError::new("BRANCH_NOT_FOUND", format!("Branch not found: {branch_id}"))
    })?;
    let mut result = document.clone();
    let alternatives = result.alternatives.iter().map(|alternative| (alternative.id.clone(), alternative.clone())).collect::<std::collections::HashMap<_, _>>();
    let mut fit_value = serde_json::to_value(&result.fit).map_err(|error| FormatError::new("INVALID_FIT", error.to_string()))?;
    for list_name in ["modules", "drones", "cargo"] {
        let Some(items) = fit_value.get_mut(list_name).and_then(Value::as_array_mut) else { continue };
        for item in items {
            let Some(alt_id) = item.get("alt_id").and_then(Value::as_str) else { continue };
            let Some(index) = branch.picks.get(alt_id) else { continue };
            let Some(option) = alternatives.get(alt_id).and_then(|alt| alt.options.get(*index)) else { continue };
            apply_option(item, option, list_name);
        }
    }
    result.fit = serde_json::from_value(fit_value).map_err(|error| FormatError::new("INVALID_FIT", error.to_string()))?;
    result.active_branch = Presence::Value(branch_id.to_owned());
    Ok(result)
}

fn resolve_fit(document: &FitDocument, library: &Library, depth: usize) -> Result<Value, FormatError> {
    let fit = &document.fit;
    let character_id = if document.refs.character_id.is_empty() { "all5" } else { &document.refs.character_id };
    let character = library.characters.get(character_id).or_else(|| library.characters.get("all5"));
    let character_security_status = character.map(|value| value.security_status.clone()).unwrap_or(Presence::Null);
    let character_value = json!({
        "skills": {
            "default_level": character.map(|value| value.default_level).unwrap_or(5),
            "levels": character.map(|value| value.levels.clone()).unwrap_or_default(),
        },
        "security_status": character_security_status,
        "alpha_clone": character.and_then(|value| value.alpha_clone).unwrap_or(false),
    });
    let modules = fit.modules.iter().map(|module| {
        let mut output = json!({
            "type_id": module.type_id,
            "slot": module.slot,
            "state": module.state,
            "charge_type_id": module.charge_type_id,
            "mutation": module.mutation,
            "spool": module.spool.as_ref().map(|amount| json!({ "type": "spool_scale", "amount": amount })).unwrap_or(Value::Null),
        });
        if let Some(id) = &module.id {
            output.as_object_mut().expect("object").insert("id".to_owned(), json!(id));
        }
        output
    }).collect::<Vec<_>>();
    let drones = fit.drones.iter().map(|drone| {
        let mut output = json!({ "type_id": drone.type_id, "quantity": drone.quantity, "active": drone.active });
        if let Some(id) = &drone.id {
            output.as_object_mut().expect("object").insert("id".to_owned(), json!(id));
        }
        if let Presence::Value(mutation) = &drone.mutation {
            output.as_object_mut().expect("object").insert("mutation".to_owned(), json!(mutation));
        }
        output
    }).collect::<Vec<_>>();
    let fighters = fit.fighters.iter().map(|fighter| {
        let mut output = json!({ "type_id": fighter.type_id, "quantity": fighter.quantity, "active": fighter.active, "abilities": fighter.abilities });
        if let Some(id) = &fighter.id {
            output.as_object_mut().expect("object").insert("id".to_owned(), json!(id));
        }
        output
    }).collect::<Vec<_>>();
    let boosters = fit.boosters.iter().map(|booster| {
        json!({
            "type_id": booster.get("type_id").cloned().unwrap_or(Value::Null),
            "side_effects": booster.get("side_effects").and_then(Value::as_array).cloned().unwrap_or_default(),
        })
    }).collect::<Vec<_>>();
    let damage_id = if document.refs.damage_pattern_id.is_empty() { "uniform" } else { &document.refs.damage_pattern_id };
    let damage_pattern = library.damage_patterns.get(damage_id)
        .filter(|pattern| pattern.id != "uniform")
        .map(|pattern| json!({ "em": pattern.em, "thermal": pattern.thermal, "kinetic": pattern.kinetic, "explosive": pattern.explosive }))
        .unwrap_or(Value::Null);
    let profile_id = if document.refs.target_profile_id.is_empty() { "none" } else { &document.refs.target_profile_id };
    let target_profile = library.target_profiles.get(profile_id)
        .filter(|profile| profile.id != "none")
        .map(|profile| profile_value(profile))
        .unwrap_or(Value::Null);

    let mut booster_ids = Vec::new();
    let mut seen = BTreeSet::new();
    if depth == 0 {
        {
            for id in &document.links.booster_fit_ids {
                if id != &document.id && library.fits.contains_key(id) && seen.insert(id.to_owned()) {
                    booster_ids.push(id.to_owned());
                }
            }
        }
        for fleet in library.fleets.values() {
            if !fleet.members.iter().any(|member| member.fit_id == document.id) {
                continue;
            }
            for member in fleet.members.iter().filter(|member| member.role == "command") {
                if member.fit_id != document.id && library.fits.contains_key(&member.fit_id) && seen.insert(member.fit_id.clone()) {
                    booster_ids.push(member.fit_id.clone());
                }
            }
        }
    }
    let booster_fits = booster_ids.iter().filter_map(|id| library.fits.get(id))
        .map(|nested| resolve_fit(nested, library, depth + 1)).collect::<Result<Vec<_>, _>>()?;

    let mut projected = Vec::new();
    if depth == 0 {
        for item in &fit.projected {
            let base = json!({ "amount": item.amount, "distance_m": item.distance_m });
            let result = match item.kind.as_str() {
                "module" => Some(json!({ "kind": "module", "module": {
                    "type_id": item.type_id.unwrap_or(0), "state": item.state.as_ref().cloned().unwrap_or(crate::types::ModState::Active),
                    "charge_type_id": item.charge_type_id,
                }, "amount": base["amount"], "distance_m": base["distance_m"] })),
                "drone" => {
                    let quantity = item.quantity.as_ref().copied().unwrap_or(1);
                    Some(json!({ "kind": "drone", "drone": { "type_id": item.type_id.unwrap_or(0), "quantity": quantity, "active": quantity },
                        "amount": base["amount"], "distance_m": base["distance_m"] }))
                }
                "fighter" => Some(json!({ "kind": "fighter", "fighter": {
                    "type_id": item.type_id.unwrap_or(0), "quantity": item.quantity.as_ref().copied().unwrap_or(1), "active": true, "abilities": null,
                }, "amount": base["amount"], "distance_m": base["distance_m"] })),
                _ => None,
            };
            if let Some(value) = result { projected.push(value); }
        }
        for link in &document.links.projected_fits {
                let id = &link.fit_id;
                let Some(nested) = library.fits.get(id) else { continue };
                projected.push(json!({
                    "kind": "fit",
                    "fit": resolve_fit(nested, library, depth + 1)?,
                    "amount": link.amount,
                    "distance_m": link.distance_m,
                }));
        }
    }
    let mut request = json!({
        "schema_version": 1,
        "ship": { "type_id": fit.ship.type_id, "mode_type_id": fit.ship.mode_type_id },
        "character": character_value,
        "modules": modules,
        "drones": drones,
        "fighters": fighters,
        "implants": fit.implants,
        "boosters": boosters,
        "cargo": fit.cargo.iter().map(|cargo| {
            let mut output = json!({ "type_id": cargo.type_id, "quantity": cargo.quantity });
            if let Some(id) = &cargo.id {
                output.as_object_mut().expect("object").insert("id".to_owned(), json!(id));
            }
            output
        }).collect::<Vec<_>>(),
        "fleet": { "buffs": fit.fleet_buffs, "booster_fits": booster_fits },
        "projected": projected,
        "environment": { "effect_type_ids": fit.environment.effect_type_ids, "system_security": security_name(&fit.environment.system_security) },
        "damage_pattern": damage_pattern,
        "target_profile": target_profile,
        "overrides": fit.overrides,
        "options": {
            "factor_reload": fit.options.factor_reload,
            "default_spool": { "type": "spool_scale", "amount": fit.options.spool },
            "rah": fit.options.rah,
            "include_attributes": "none",
            "sources": false,
            "validate": true,
            "cap_sim": { "reload": false, "stagger": false, "max_time_s": null },
        }
    });
    if depth == 0 {
        let scenarios = document.refs.scenario_ids.iter()
            .filter_map(|id| library.scenarios.get(id))
            .map(|scenario| scenario_request(library, scenario)).collect::<Result<Vec<_>, _>>()?;
        if !scenarios.is_empty() {
            request.as_object_mut().expect("object").insert("scenarios".to_owned(), json!(scenarios));
        }
    }
    Ok(request)
}

pub fn resolve(library: &Library, fit_id: &str) -> Result<Value, FormatError> {
    resolve_with_options(library, fit_id, ResolveOptions::default())
}

pub fn resolve_with_options(library: &Library, fit_id: &str, options: ResolveOptions) -> Result<Value, FormatError> {
    let original = library.fits.get(fit_id).ok_or_else(|| FormatError::new("FIT_NOT_FOUND", format!("Fit not found: {fit_id}")))?;
    let document = match options.branch {
        Some(branch) => apply_branch(original, &branch)?,
        None => original.clone(),
    };
    resolve_fit(&document, library, 0)
}

pub fn resolve_fit_document(document: &FitDocument, library: &Library, depth: usize) -> Result<Value, FormatError> {
    resolve_fit(document, library, depth)
}
