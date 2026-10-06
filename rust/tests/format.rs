use exfa_format::{
    from_files, migrate, read_directory, resolve, resolve_with_options, to_files, write_directory,
    Library, ResolveOptions,
};
use serde_json::Value;
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
