use crate::types::{FitDocument, Library};
use crate::FormatError;
use serde_json::{json, Map, Value};

fn object(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn array(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

fn string_or(value: Option<&Value>, fallback: &str) -> String {
    value.and_then(Value::as_str).unwrap_or(fallback).to_owned()
}

fn set_map_default(map: &mut Map<String, Value>, key: &str, value: Value) {
    if !map.get(key).is_some_and(Value::is_object) {
        map.insert(key.to_owned(), value);
    }
}

fn legacy_ui(existing: Option<&Value>, legacy: Value) -> Value {
    let mut ui = object(existing.unwrap_or(&Value::Null));
    let mut prior = object(ui.get("legacy").unwrap_or(&Value::Null));
    if let Some(additional) = legacy.as_object() {
        for (key, value) in additional {
            prior.insert(key.clone(), value.clone());
        }
    }
    if !prior.is_empty() {
        ui.insert("legacy".to_owned(), Value::Object(prior));
    }
    Value::Object(ui)
}

pub fn migrate_fit_document(value: Value, fallback_id: &str) -> Result<FitDocument, FormatError> {
    let mut source = object(&value);
    let format = source.get("format").and_then(Value::as_str).unwrap_or("");
    if format != "exfa/fit@1" {
        return migrate_legacy_fit(source, fallback_id);
    }
    source.entry("id").or_insert_with(|| json!(fallback_id));
    source.entry("name").or_insert_with(|| json!("Untitled fit"));
    source.insert("format".to_owned(), json!("exfa/fit@1"));
    set_map_default(&mut source, "fit", json!({}));
    let mut refs = object(source.get("refs").unwrap_or(&Value::Null));
    refs.entry("character_id").or_insert_with(|| json!("all5"));
    refs.entry("damage_pattern_id").or_insert_with(|| json!("uniform"));
    refs.entry("target_profile_id").or_insert_with(|| json!("none"));
    if !refs.get("scenario_ids").is_some_and(Value::is_array) {
        refs.insert("scenario_ids".to_owned(), json!([]));
    }
    source.insert("refs".to_owned(), Value::Object(refs));
    let mut links = object(source.get("links").unwrap_or(&Value::Null));
    if !links.get("booster_fit_ids").is_some_and(Value::is_array) {
        links.insert("booster_fit_ids".to_owned(), json!([]));
    }
    if !links.get("projected_fits").is_some_and(Value::is_array) {
        links.insert("projected_fits".to_owned(), json!([]));
    }
    source.insert("links".to_owned(), Value::Object(links));
    for key in ["alternatives", "branches", "history"] {
        if !source.get(key).is_some_and(Value::is_array) {
            source.insert(key.to_owned(), json!([]));
        }
    }
    let normalized = serde_json::from_value(Value::Object(source)).map_err(|error| FormatError::new("INVALID_FIT_DOCUMENT", error.to_string()))?;
    Ok(normalized)
}

fn migrate_legacy_fit(mut source: Map<String, Value>, fallback_id: &str) -> Result<FitDocument, FormatError> {
    let known = [
        "id", "name", "ship_type_id", "mode_type_id", "modules", "drones", "fighters", "implants", "boosters", "cargo",
        "projected", "fleet", "environment", "system_security", "character_id", "damage_pattern_id", "target_profile_id",
        "options", "notes", "overrides", "folder", "tags", "created", "modified", "ui",
    ];
    let legacy_extra = source.iter().filter(|(key, _)| !known.contains(&key.as_str())
        && !["format"].contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone())).collect::<Map<_, _>>();
    let old_projected = array(source.get("projected"));
    let mut projected = Vec::new();
    let mut projected_fits = Vec::new();
    for item in old_projected {
        if item.get("kind").and_then(Value::as_str) == Some("fit") {
            if let Some(fit_id) = item.get("fit_id").and_then(Value::as_str) {
                projected_fits.push(json!({
                    "fit_id": fit_id,
                    "amount": item.get("amount").cloned().unwrap_or(json!(1)),
                    "distance_m": item.get("distance_m").cloned().unwrap_or(Value::Null),
                }));
            }
        } else {
            projected.push(item);
        }
    }
    let fleet = object(source.get("fleet").unwrap_or(&Value::Null));
    let environment_value = source.get("environment").cloned().unwrap_or_else(|| json!([]));
    let fleet_unknown = unknown_fields(&fleet, &["booster_fit_ids", "buffs"]);
    let environment_unknown = if environment_value.is_array() {
        Map::new()
    } else {
        unknown_fields(&object(&environment_value), &["effect_type_ids", "system_security"])
    };
    let options_unknown = unknown_fields(&object(source.get("options").unwrap_or(&Value::Null)), &["factor_reload", "spool", "rah"]);
    let effect_type_ids = if environment_value.is_array() {
        environment_value.clone()
    } else {
        environment_value.get("effect_type_ids").cloned().unwrap_or_else(|| json!([]))
    };
    let system_security = source.get("system_security").cloned()
        .or_else(|| environment_value.get("system_security").cloned()).unwrap_or(Value::Null);
    let mut options = object(source.get("options").unwrap_or(&Value::Null));
    options.entry("factor_reload").or_insert_with(|| json!(false));
    options.entry("spool").or_insert_with(|| json!(1));
    options.entry("rah").or_insert_with(|| json!("adapt"));
    let fit = json!({
        "ship": {
            "type_id": source.get("ship_type_id").cloned().unwrap_or(json!(0)),
            "mode_type_id": source.get("mode_type_id").cloned().unwrap_or(Value::Null),
        },
        "modules": array(source.get("modules")),
        "drones": array(source.get("drones")),
        "fighters": array(source.get("fighters")),
        "implants": array(source.get("implants")),
        "boosters": array(source.get("boosters")),
        "cargo": array(source.get("cargo")),
        "projected": projected,
        "fleet_buffs": fleet.get("buffs").cloned().unwrap_or_else(|| json!([])),
        "environment": { "effect_type_ids": effect_type_ids, "system_security": system_security },
        "overrides": array(source.get("overrides")),
        "options": options
    });
    let mut document = json!({
        "format": "exfa/fit@1",
        "id": string_or(source.get("id"), fallback_id),
        "name": string_or(source.get("name"), "Untitled fit"),
        "fit": fit,
        "refs": {
            "character_id": string_or(source.get("character_id"), "all5"),
            "damage_pattern_id": string_or(source.get("damage_pattern_id"), "uniform"),
            "target_profile_id": string_or(source.get("target_profile_id"), "none"),
            "scenario_ids": [],
        },
        "links": {
            "booster_fit_ids": fleet.get("booster_fit_ids").cloned().unwrap_or_else(|| json!([])),
            "projected_fits": projected_fits,
        },
        "alternatives": [],
        "branches": [],
        "history": [],
    });
    let doc_map = document.as_object_mut().expect("object");
    for key in ["notes", "tags", "folder", "created", "modified"] {
        if let Some(value) = source.get(key) {
            doc_map.insert(key.to_owned(), value.clone());
        }
    }
    let mut all_legacy = legacy_extra;
    if !fleet_unknown.is_empty() { all_legacy.insert("fleet".to_owned(), Value::Object(fleet_unknown)); }
    if !environment_unknown.is_empty() { all_legacy.insert("environment".to_owned(), Value::Object(environment_unknown)); }
    if !options_unknown.is_empty() { all_legacy.insert("options".to_owned(), Value::Object(options_unknown)); }
    if !all_legacy.is_empty() {
        let ui = legacy_ui(source.get("ui"), Value::Object(all_legacy));
        doc_map.insert("ui".to_owned(), ui);
    } else if let Some(ui) = source.remove("ui") {
        doc_map.insert("ui".to_owned(), ui);
    }
    serde_json::from_value(document).map_err(|error| FormatError::new("INVALID_FIT_DOCUMENT", error.to_string()))
}

fn unknown_fields(source: &Map<String, Value>, known: &[&str]) -> Map<String, Value> {
    source.iter().filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone())).collect()
}

fn migrate_legacy_library(value: Value) -> Result<Library, FormatError> {
    let source = object(&value);
    if !source.get("fits").is_some_and(Value::is_object) {
        return Err(FormatError::new("INVALID_LIBRARY", "Legacy library must contain a fits map"));
    }
    let mut fits = Map::new();
    for (id, fit) in source["fits"].as_object().expect("fits object") {
        let document = migrate_fit_document(fit.clone(), id)?;
        fits.insert(id.clone(), serde_json::to_value(document).map_err(|error| FormatError::new("INVALID_FIT_DOCUMENT", error.to_string()))?);
    }
    let mut library = json!({
        "format": "exfa/library@1",
        "folders": source.get("folders").and_then(Value::as_array).cloned().unwrap_or_default(),
        "fits": fits,
        "characters": source.get("characters").cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        "damage_patterns": source.get("damage_patterns").or_else(|| source.get("damagePatterns")).cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        "target_profiles": source.get("target_profiles").or_else(|| source.get("targetProfiles")).cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        "scenarios": source.get("scenarios").cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        "fleets": source.get("fleets").cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
    });
    let extras = unknown_fields(&source, &[
        "format", "fits", "characters", "damagePatterns", "damage_patterns", "targetProfiles", "target_profiles", "folders", "scenarios", "fleets",
    ]);
    if !extras.is_empty() {
        let extra_value = json!({ "library": extras });
        let ui = legacy_ui(None, extra_value);
        library.as_object_mut().expect("object").insert("ui".to_owned(), ui);
    }
    serde_json::from_value(library).map_err(|error| FormatError::new("INVALID_LIBRARY", error.to_string()))
}

pub fn migrate(value: Value) -> Result<Library, FormatError> {
    let mut source = object(&value);
    let format = source.get("format").and_then(Value::as_str).unwrap_or("");
    if format == "eve-fit-web-library" {
        let lib = source.remove("lib").ok_or_else(|| FormatError::new("INVALID_LIBRARY", "Backup wrapper has no lib field"))?;
        let mut library = migrate_legacy_library(lib)?;
        let backup_keys = ["format", "version", "exported_at", "implant_sets"];
        let mut backup = unknown_fields(&source, &[]);
        for key in backup_keys {
            if let Some(value) = source.get(key) {
                backup.insert(key.to_owned(), value.clone());
            }
        }
        if !backup.is_empty() {
            let mut prior = library.extra.remove("ui").unwrap_or(Value::Null);
            prior = legacy_ui(Some(&prior), json!({ "backup": backup }));
            library.extra.insert("ui".to_owned(), prior);
        }
        return Ok(library);
    }
    if format == "exfa/library@1" {
        source.insert("format".to_owned(), json!("exfa/library@1"));
        for key in ["folders", "fits", "characters", "damage_patterns", "target_profiles", "scenarios", "fleets"] {
            if !source.contains_key(key) {
                let empty = if key == "folders" { json!([]) } else { json!({}) };
                source.insert(key.to_owned(), empty);
            }
        }
        let fits = source["fits"].as_object().cloned().ok_or_else(|| FormatError::new("INVALID_LIBRARY", "Library fits must be an object"))?;
        let mut migrated_fits = Map::new();
        for (id, fit) in fits {
            let document = migrate_fit_document(fit, &id)?;
            migrated_fits.insert(id, serde_json::to_value(document).map_err(|error| FormatError::new("INVALID_FIT_DOCUMENT", error.to_string()))?);
        }
        source.insert("fits".to_owned(), Value::Object(migrated_fits));
        return serde_json::from_value(Value::Object(source)).map_err(|error| FormatError::new("INVALID_LIBRARY", error.to_string()));
    }
    if format.starts_with("exfa/library@") {
        let version = format.trim_start_matches("exfa/library@").parse::<u32>().unwrap_or(0);
        if version > 1 {
            return Err(FormatError::new("UNSUPPORTED_VERSION", format!("Unsupported library version: {version}")));
        }
        return Err(FormatError::new("INVALID_LIBRARY", format!("Unsupported library format: {format}")));
    }
    if source.get("fits").is_some_and(Value::is_object)
        && source["fits"].as_object().is_some_and(|fits| fits.values().any(|fit| fit.get("ship_type_id").is_some()))
    {
        return migrate_legacy_library(Value::Object(source));
    }
    Err(FormatError::new("INVALID_LIBRARY", "Unrecognized library format"))
}
