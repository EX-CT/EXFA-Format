use crate::resolve::{apply_branch, resolve_fit_document, ResolveOptions};
use crate::types::{Group, GroupRelationKind, Library};
use crate::util::uid;
use crate::FormatError;
use serde_json::{json, Value};
use std::collections::HashMap;

/// A fresh empty group document (`exfa/group@1`).
pub fn new_group(name: Option<&str>, id: Option<&str>) -> Group {
    Group {
        format: "exfa/group@1".to_owned(),
        id: id.map(str::to_owned).unwrap_or_else(uid),
        name: name.unwrap_or("New group").to_owned(),
        ..Group::default()
    }
}

#[derive(Clone, Debug)]
pub struct CompiledGroup {
    pub request: Value,
    pub issues: Vec<String>,
}

/// Lowers a group into one `exfa/compute@1` batch request: every actor resolves to a `batch.fits[]` entry,
/// `project` relations push `{kind:"fit"}` entries (with a strict-whitelist `select` when the relation names
/// `source_item_ids`) onto the target's `projected[]`, and `command` relations push the source request onto the
/// target's `fleet.booster_fits[]`. Problems are reported as issues, not returned as errors.
pub fn compile_group(library: &Library, group: &Group, options: &ResolveOptions) -> Result<CompiledGroup, FormatError> {
    let mut issues = Vec::new();
    let mut resolved: HashMap<String, Value> = HashMap::new();
    let mut doc_names: HashMap<String, String> = HashMap::new();
    for actor in &group.actors {
        let Some(original) = library.fits.get(&actor.fit_id) else {
            issues.push(format!("actor '{}': fit not found: '{}'", actor.id, actor.fit_id));
            continue;
        };
        let document = match &options.branch {
            Some(branch) => apply_branch(original, branch)?,
            None => original.clone(),
        };
        let request = resolve_fit_document(&document, library, 0)?;
        doc_names.insert(actor.id.clone(), document.name.clone());
        resolved.insert(actor.id.clone(), request);
    }

    for relation in &group.relations {
        if relation.enabled == Some(false) {
            continue;
        }
        let source_actor = group.actors.iter().find(|actor| actor.id == relation.source);
        if source_actor.is_none() || !resolved.contains_key(&relation.source) {
            issues.push(format!("relation '{}': source actor '{}' is missing or unresolved", relation.id, relation.source));
            continue;
        }
        let source_actor = source_actor.expect("checked above");
        let source_request = resolved.get(&relation.source).expect("checked above").clone();
        let source_doc = library.fits.get(&source_actor.fit_id).expect("resolved fit must exist");

        let mut select = Value::Null;
        let mut has_select = false;
        if !relation.source_item_ids.is_empty() {
            let mut module_ids = Vec::new();
            let mut drone_ids = Vec::new();
            let mut fighter_ids = Vec::new();
            for item_id in &relation.source_item_ids {
                if source_doc.fit.modules.iter().any(|item| item.id.as_deref() == Some(item_id.as_str())) {
                    module_ids.push(json!(item_id));
                } else if source_doc.fit.drones.iter().any(|item| item.id.as_deref() == Some(item_id.as_str())) {
                    drone_ids.push(json!(item_id));
                } else if source_doc.fit.fighters.iter().any(|item| item.id.as_deref() == Some(item_id.as_str())) {
                    fighter_ids.push(json!(item_id));
                } else {
                    issues.push(format!("relation '{}': unknown source item '{}' in fit '{}'", relation.id, item_id, source_doc.id));
                }
            }
            select = json!({ "module_ids": module_ids, "drone_ids": drone_ids, "fighter_ids": fighter_ids });
            has_select = true;
        }

        for target_id in &relation.targets {
            let target_known = group.actors.iter().any(|actor| &actor.id == target_id) && resolved.contains_key(target_id);
            if !target_known {
                issues.push(format!("relation '{}': target actor '{}' is missing or unresolved", relation.id, target_id));
                continue;
            }
            let Some(target_request) = resolved.get_mut(target_id) else { continue };
            match relation.kind {
                GroupRelationKind::Project => {
                    let mut entry = json!({
                        "kind": "fit",
                        "fit": source_request.clone(),
                        "amount": relation.amount.unwrap_or(1.0),
                        "distance_m": relation.distance_m.as_ref().copied(),
                    });
                    if has_select {
                        entry.as_object_mut().expect("object").insert("select".to_owned(), select.clone());
                    }
                    target_request.pointer_mut("/projected").and_then(Value::as_array_mut).expect("projected").push(entry);
                }
                GroupRelationKind::Command => {
                    target_request.pointer_mut("/fleet/booster_fits").and_then(Value::as_array_mut).expect("booster_fits").push(source_request.clone());
                }
            }
        }
    }

    let fits = group.actors.iter().filter_map(|actor| {
        resolved.get(&actor.id).map(|request| {
            let label = actor.label.clone().or_else(|| doc_names.get(&actor.id).cloned()).unwrap_or_default();
            json!({ "id": actor.id, "label": label, "fit": request })
        })
    }).collect::<Vec<_>>();
    Ok(CompiledGroup {
        request: json!({
            "format": "exfa/compute@1",
            "operation": "batch",
            "batch": { "batch_version": 1, "fits": fits },
        }),
        issues,
    })
}
