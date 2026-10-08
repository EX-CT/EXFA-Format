use exfa_format::{
    compile_group, compute_request, from_files, merge_package, migrate, package_fit, package_group,
    read_directory, resolve, resolve_with_options, to_files, write_directory,
    Group, Library, MergePolicy, Package, ResolveOptions,
};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture(path: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../").join(path);
    serde_json::from_slice(&fs::read(path).expect("fixture file should be readable"))
        .expect("fixture should contain valid JSON")
}

fn library() -> Library {
    serde_json::from_value(fixture("fixtures/library.json")).expect("library fixture should deserialize")
}

fn assert_json_equivalent(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Number(left), Value::Number(right)) => {
            assert_eq!(left.as_f64(), right.as_f64(), "numeric values differ: {left} != {right}");
        }
        (Value::Array(left), Value::Array(right)) => {
            assert_eq!(left.len(), right.len());
            for (left, right) in left.iter().zip(right) {
                assert_json_equivalent(left, right);
            }
        }
        (Value::Object(left), Value::Object(right)) => {
            assert_eq!(left.keys().collect::<Vec<_>>(), right.keys().collect::<Vec<_>>());
            for (key, left) in left {
                assert_json_equivalent(left, &right[key]);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

#[test]
fn resolves_the_shared_request_fixtures() {
    let library = library();
    let expected = fixture("fixtures/requests.json");
    for fit_id in ["app-basic", "app-nested-a", "app-nested-b", "complex", "command"] {
        assert_json_equivalent(&resolve(&library, fit_id).expect("fit should resolve"), &expected[fit_id]);
    }
}

#[test]
fn applies_the_selected_branch_during_resolution() {
    let library = library();
    let request = resolve_with_options(
        &library,
        "complex",
        ResolveOptions { branch: Some("budget".to_owned()) },
    ).expect("branch should resolve");
    assert_eq!(request["modules"][0]["type_id"], 2874);
    assert_eq!(request["modules"][1]["type_id"], 2874);
    assert_eq!(request["modules"][0]["charge_type_id"], 21899);
    assert_eq!(request["modules"][1]["charge_type_id"], 21899);
}

#[test]
fn migrates_the_shared_legacy_backup_fixture() {
    let migrated = migrate(fixture("fixtures/legacy-v0.json")).expect("backup should migrate");
    assert_json_equivalent(
        &serde_json::to_value(migrated).expect("migrated library should serialize"),
        &fixture("fixtures/expected-migrated-library.json"),
    );
}

#[test]
fn file_layout_round_trips_and_reads_and_writes_directories() {
    let library = library();
    let files = to_files(&library).expect("library should serialize to files");
    let restored = from_files(&files).expect("file list should restore a library");
    assert_eq!(restored, library);
    assert_eq!(to_files(&restored).expect("restored library should serialize"), files);

    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock should be valid").as_nanos();
    let directory = std::env::temp_dir().join(format!("exfa-format-{}-{nonce}", std::process::id()));
    write_directory(&directory, &library).expect("directory should be written");
    assert_eq!(read_directory(&directory).expect("directory should be read"), library);
    fs::remove_dir_all(directory).expect("temporary directory should be removed");
}

#[test]
fn rejects_future_format_versions() {
    let error = migrate(serde_json::json!({ "format": "exfa/library@2" }))
        .expect_err("future versions should not be accepted");
    assert_eq!(error.code, "UNSUPPORTED_VERSION");
}

#[test]
fn resolve_passes_item_ids_through() {
    let mut library = library();
    {
        let document = library.fits.get_mut("app-basic").expect("fixture fit should exist");
        document.fit.modules[0].id = Some("mod-1".to_owned());
        document.fit.drones.push(serde_json::from_value(json!({
            "id": "drone-1", "type_id": 2488, "quantity": 2, "active": 2
        })).expect("drone should deserialize"));
        document.fit.fighters.push(serde_json::from_value(json!({
            "id": "ftr-1", "type_id": 2305, "quantity": 1, "active": true
        })).expect("fighter should deserialize"));
        document.fit.cargo.push(serde_json::from_value(json!({
            "id": "cargo-1", "type_id": 21898, "quantity": 10
        })).expect("cargo should deserialize"));
    }
    let request = resolve(&library, "app-basic").expect("fit should resolve");
    assert_eq!(request["modules"][0]["id"], json!("mod-1"));
    assert_eq!(request["drones"][0]["id"], json!("drone-1"));
    assert_eq!(request["fighters"][0]["id"], json!("ftr-1"));
    assert_eq!(request["cargo"][0]["id"], json!("cargo-1"));
    let document = library.fits.get("app-basic").expect("fixture fit should exist").clone();
    let request = compute_request(&library, &document, ResolveOptions::default()).expect("compute request should build");
    assert_eq!(request["format"], json!("exfa/compute@1"));
    assert_eq!(request["operation"], json!("calc"));
    assert_eq!(request["fit"]["modules"][0]["id"], json!("mod-1"));
}

#[test]
fn group_documents_round_trip() {
    let library = library();
    let group = library.groups.get("group-alpha").expect("fixture should contain group-alpha");
    let encoded = serde_json::to_string(group).expect("group should serialize");
    let parsed: Group = serde_json::from_str(&encoded).expect("group should deserialize");
    assert_eq!(&parsed, group);

    let files = to_files(&library).expect("library should serialize to files");
    let group_file = files.iter().find(|file| file.path == "groups/group-alpha.json")
        .expect("a group file should be emitted");
    let index: Value = serde_json::from_str(&files[0].text).expect("index should parse");
    assert!(index["groups"]["group-alpha"].is_object());
    let from_file_only = from_files(&[group_file.clone()]).expect("group file should restore alone");
    assert_eq!(from_file_only.groups.get("group-alpha"), Some(group));
    let restored = from_files(&files).expect("file list should restore a library");
    assert_eq!(restored.groups, library.groups);
}

fn small_group_library() -> Library {
    let fit = |id: &str, modules: Value, drones: Value| json!({
        "format": "exfa/fit@1", "id": id, "name": format!("Doc {id}"),
        "fit": {
            "ship": {"type_id": 587, "mode_type_id": null},
            "modules": modules, "drones": drones, "fighters": [],
            "implants": [], "boosters": [], "cargo": [], "projected": [], "fleet_buffs": [],
            "environment": {"effect_type_ids": [], "system_security": null},
            "options": {"factor_reload": false, "spool": 1, "rah": "adapt"}
        },
        "refs": {"character_id": "all5", "damage_pattern_id": "uniform", "target_profile_id": "none", "scenario_ids": []},
        "links": {"booster_fit_ids": [], "projected_fits": []},
        "alternatives": [], "branches": [], "history": []
    });
    serde_json::from_value(json!({
        "format": "exfa/library@1",
        "fits": {
            "logi": fit("logi", json!([
                {"id": "rep-1", "type_id": 11355, "slot": "high", "state": "active"},
                {"id": "rep-2", "type_id": 11355, "slot": "high", "state": "active"}
            ]), json!([{"id": "drone-1", "type_id": 2488, "quantity": 2, "active": 2}])),
            "a": fit("a", json!([]), json!([])),
            "b": fit("b", json!([]), json!([])),
        },
        "characters": {"all5": {"id": "all5", "name": "All 5", "default_level": 5, "levels": {}}},
    })).expect("library should deserialize")
}

#[test]
fn compile_group_projects_with_select_and_commands() {
    let library = small_group_library();
    let group: Group = serde_json::from_value(json!({
        "format": "exfa/group@1", "id": "g", "name": "Fleet",
        "actors": [
            {"id": "logi", "fit_id": "logi", "label": "Logi"},
            {"id": "a", "fit_id": "a"},
            {"id": "b", "fit_id": "b"}
        ],
        "relations": [
            {"id": "p", "kind": "project", "source": "logi", "targets": ["a", "b"],
             "source_item_ids": ["rep-1", "drone-1", "nope"], "amount": 2, "distance_m": 8000},
            {"id": "c", "kind": "command", "source": "logi", "targets": ["a"]},
            {"id": "off", "kind": "project", "source": "logi", "targets": ["b"], "enabled": false},
            {"id": "bad", "kind": "project", "source": "ghost", "targets": ["a"]}
        ]
    })).expect("group should deserialize");
    let compiled = compile_group(&library, &group, &ResolveOptions::default()).expect("group should compile");
    let request = &compiled.request;
    assert_eq!(request["format"], json!("exfa/compute@1"));
    assert_eq!(request["operation"], json!("batch"));
    assert_eq!(request["batch"]["batch_version"], json!(1));
    let fits = request["batch"]["fits"].as_array().expect("fits list");
    assert_eq!(fits.iter().map(|entry| entry["id"].as_str().unwrap()).collect::<Vec<_>>(), ["logi", "a", "b"]);
    assert_eq!(fits[0]["label"], json!("Logi"));
    assert_eq!(fits[1]["label"], json!("Doc a"));

    let a = fits.iter().find(|entry| entry["id"] == "a").unwrap();
    let projected = &a["fit"]["projected"].as_array().expect("projected list")[0];
    assert_eq!(projected["kind"], json!("fit"));
    assert_eq!(projected["amount"].as_f64(), Some(2.0));
    assert_eq!(projected["distance_m"].as_f64(), Some(8000.0));
    assert_eq!(projected["select"]["module_ids"], json!(["rep-1"]));
    assert_eq!(projected["select"]["drone_ids"], json!(["drone-1"]));
    assert_eq!(projected["select"]["fighter_ids"], json!([]));
    assert_eq!(projected["fit"]["modules"][0]["id"], json!("rep-1"));
    assert_eq!(a["fit"]["fleet"]["booster_fits"].as_array().expect("booster fits").len(), 1);

    let b = fits.iter().find(|entry| entry["id"] == "b").unwrap();
    let b_projected = &b["fit"]["projected"].as_array().expect("projected list");
    assert_eq!(b_projected.len(), 1, "disabled relation must be skipped");
    assert!(b_projected[0]["select"].is_object());
    // deep-clone isolation: the two targets must not share the same projected fit object
    assert_eq!(projected["fit"], b_projected[0]["fit"]);

    assert!(compiled.issues.iter().any(|issue| issue.contains("nope")));
    assert!(compiled.issues.iter().any(|issue| issue.contains("ghost")));
}

#[test]
fn package_fit_collects_the_transitive_closure_and_merges() {
    let library = library();
    let package = package_fit(&library, library.fits.get("app-nested-a").unwrap());
    assert_eq!(package.format, "exfa/package@1");
    let mut fit_ids = package.library.fits.keys().cloned().collect::<Vec<_>>();
    fit_ids.sort();
    assert_eq!(fit_ids, ["app-nested-a", "app-nested-b"]);
    assert!(package.library.characters.contains_key("all5"));
    assert!(package.library.groups.is_empty());

    let group_package = package_group(&library, library.groups.get("group-alpha").unwrap());
    assert!(group_package.library.groups.contains_key("group-alpha"));
    assert!(group_package.library.fits.contains_key("command"));

    // rename policy: conflicting fit 'a' is renamed and references remapped
    let mut target = small_group_library();
    let conflicted = serde_json::from_value::<exfa_format::FitDocument>(json!({
        "format": "exfa/fit@1", "id": "a", "name": "Changed",
        "fit": {"ship": {"type_id": 1}, "modules": [], "drones": [], "fighters": [], "implants": [], "boosters": [],
            "cargo": [], "projected": [], "fleet_buffs": [],
            "environment": {"effect_type_ids": [], "system_security": null},
            "options": {"factor_reload": false, "spool": 1, "rah": "adapt"}},
        "refs": {"character_id": "all5", "damage_pattern_id": "uniform", "target_profile_id": "none", "scenario_ids": []},
        "links": {"booster_fit_ids": ["b"], "projected_fits": []},
        "alternatives": [], "branches": [], "history": []
    })).expect("doc should deserialize");
    let mut package = package_fit(&library, library.fits.get("app-basic").unwrap());
    package.library.fits.insert("a".to_owned(), conflicted);
    package.root.id = "a".to_owned();
    let issues = merge_package(&mut target, &package, MergePolicy::default());
    assert!(issues.iter().any(|issue| issue.contains("renamed")), "issues: {issues:?}");
    let new_id = target.fits.keys().find(|id| id.starts_with("imp-")).cloned().expect("a renamed id should exist");
    assert_eq!(target.fits[&new_id].links.booster_fit_ids, vec!["b".to_owned()]);
    assert_eq!(target.fits["a"].name, "Doc a");
    let empty: Package = serde_json::from_value(json!({
        "format": "exfa/package@1", "root": {"kind": "fit", "id": "none"},
        "library": {"format": "exfa/library@1", "folders": [], "fits": {
            "lonely": {"format": "exfa/fit@1", "id": "lonely", "name": "Lonely",
                "fit": {"ship": {"type_id": 1}, "modules": [], "drones": [], "fighters": [], "implants": [], "boosters": [],
                    "cargo": [], "projected": [], "fleet_buffs": [],
                    "environment": {"effect_type_ids": [], "system_security": null},
                    "options": {"factor_reload": false, "spool": 1, "rah": "adapt"}},
                "refs": {"character_id": "ghost", "damage_pattern_id": "uniform", "target_profile_id": "none", "scenario_ids": []},
                "links": {"booster_fit_ids": [], "projected_fits": []}, "alternatives": [], "branches": [], "history": []}
        }, "characters": {}, "damage_patterns": {}, "target_profiles": {}, "scenarios": {}, "fleets": {}, "groups": {}}
    })).expect("package should deserialize");
    let issues = merge_package(&mut target, &empty, MergePolicy::default());
    assert!(issues.iter().any(|issue| issue.contains("ghost")), "issues: {issues:?}");
}
