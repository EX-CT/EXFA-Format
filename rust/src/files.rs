use crate::migrate::migrate_fit_document;
use crate::types::{Character, DamagePattern, FitDocument, Fleet, Group, Library, Scenario, TargetProfile};
use crate::FormatError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const INDEX_PATH: &str = "library.exfa.json";
const GROUP_DIR: &str = "groups";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct LibraryIndex {
    format: String,
    #[serde(default)]
    folders: Vec<String>,
    #[serde(default)]
    characters: BTreeMap<String, Character>,
    #[serde(default)]
    damage_patterns: BTreeMap<String, DamagePattern>,
    #[serde(default)]
    target_profiles: BTreeMap<String, TargetProfile>,
    #[serde(default)]
    scenarios: BTreeMap<String, Scenario>,
    #[serde(default)]
    fleets: BTreeMap<String, Fleet>,
    #[serde(default)]
    groups: BTreeMap<String, Group>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

impl From<&Library> for LibraryIndex {
    fn from(library: &Library) -> Self {
        let folders = library.folders.iter().map(|folder| safe_folder(folder)).filter(|folder| !folder.is_empty()).collect();
        Self {
            format: "exfa/library-index@1".to_owned(),
            folders,
            characters: library.characters.clone(),
            damage_patterns: library.damage_patterns.clone(),
            target_profiles: library.target_profiles.clone(),
            scenarios: library.scenarios.clone(),
            fleets: library.fleets.clone(),
            groups: library.groups.clone(),
            extra: library.extra.clone(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FormatFile {
    pub path: String,
    pub text: String,
}

fn safe_segment(value: &str, empty: &str) -> String {
    let replaced: String = value.chars().map(|character| {
        if character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            '_'
        } else {
            character
        }
    }).collect();
    let trimmed = replaced.trim();
    let trimmed = trimmed.chars().take(80).collect::<String>();
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        return empty.to_owned();
    }
    if trimmed == "." || trimmed == ".." {
        return trimmed.replace('.', "_");
    }
    trimmed.to_owned()
}

fn safe_folder(folder: &str) -> String {
    folder.split('/').map(str::trim).filter(|part| !part.is_empty())
        .map(|part| safe_segment(part, "_")).collect::<Vec<_>>().join("/")
}

fn safe_id(id: &str) -> String {
    let mut result = String::new();
    for byte in id.bytes() {
        let character = byte as char;
        if character.is_ascii_alphanumeric() || "-_.!~*'()".contains(character) {
            result.push(character);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, FormatError> {
    let mut text = serde_json::to_string_pretty(value).map_err(|error| FormatError::new("JSON_ENCODE", error.to_string()))?;
    text.push('\n');
    Ok(text)
}

pub fn to_files(library: &Library) -> Result<Vec<FormatFile>, FormatError> {
    let index = LibraryIndex::from(library);
    let mut files = vec![FormatFile { path: INDEX_PATH.to_owned(), text: pretty_json(&index)? }];
    let mut documents = library.fits.values().collect::<Vec<_>>();
    documents.sort_by_key(|document| {
        format!("{}/{}.{}.exfa.json", safe_folder(document.folder.as_deref().unwrap_or("")),
            safe_segment(&document.name, "fit"), safe_id(&document.id))
    });
    for document in documents {
        let mut on_disk = document.clone();
        on_disk.folder = None;
        let folder = safe_folder(document.folder.as_deref().unwrap_or(""));
        let name = safe_segment(&document.name, "fit");
        let path = format!("{}{name}.{}.exfa.json", if folder.is_empty() { String::new() } else { format!("{folder}/") }, safe_id(&document.id));
        files.push(FormatFile { path, text: pretty_json(&on_disk)? });
    }
    let mut groups = library.groups.values().collect::<Vec<_>>();
    groups.sort_by(|left, right| left.id.cmp(&right.id));
    for group in groups {
        files.push(FormatFile { path: format!("{GROUP_DIR}/{}.json", safe_id(&group.id)), text: pretty_json(group)? });
    }
    Ok(files)
}

fn clean_path(path: &str) -> Result<String, FormatError> {
    let normalized = path.replace('\\', "/").trim_start_matches("./").to_owned();
    if normalized.starts_with('/') || normalized.split('/').any(|part| part == "..") {
        return Err(FormatError::new("UNSAFE_PATH", format!("Unsafe format path: {path}")));
    }
    Ok(normalized)
}

pub fn from_files(files: &[FormatFile]) -> Result<Library, FormatError> {
    let mut library = Library {
        format: "exfa/library@1".to_owned(),
        ..Library::default()
    };
    let normalized = files.iter().map(|file| Ok((clean_path(&file.path)?, file)))
        .collect::<Result<Vec<_>, FormatError>>()?;
    if let Some((_, index_file)) = normalized.iter().find(|(path, _)| path == INDEX_PATH) {
        let index: LibraryIndex = serde_json::from_str(&index_file.text)
            .map_err(|error| FormatError::new("INVALID_LIBRARY_INDEX", error.to_string()))?;
        if index.format != "exfa/library-index@1" {
            return Err(FormatError::new("INVALID_LIBRARY_INDEX", "Invalid library index format"));
        }
        library.folders = index.folders.iter().map(|folder| {
            folder.split('/').map(str::trim).filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/")
        }).filter(|folder| !folder.is_empty()).collect();
        library.characters = index.characters;
        library.damage_patterns = index.damage_patterns;
        library.target_profiles = index.target_profiles;
        library.scenarios = index.scenarios;
        library.fleets = index.fleets;
        library.groups = index.groups;
        library.extra = index.extra;
    }
    for (path, file) in normalized {
        if path == INDEX_PATH {
            continue;
        }
        if path.starts_with(&format!("{GROUP_DIR}/")) && path.ends_with(".json") && !path.ends_with(".exfa.json") {
            let value: Value = serde_json::from_str(&file.text)
                .map_err(|error| FormatError::new("INVALID_GROUP", format!("{path}: {error}")))?;
            if value.get("format").and_then(Value::as_str) == Some("exfa/group@1") {
                let group: Group = serde_json::from_value(value)
                    .map_err(|error| FormatError::new("INVALID_GROUP", format!("{path}: {error}")))?;
                if group.id.is_empty() {
                    return Err(FormatError::new("MISSING_GROUP_ID", format!("Group document in {path} has no id")));
                }
                library.groups.insert(group.id.clone(), group);
            }
            continue;
        }
        if !path.ends_with(".exfa.json") {
            continue;
        }
        let value: Value = serde_json::from_str(&file.text)
            .map_err(|error| FormatError::new("INVALID_FIT_DOCUMENT", format!("{path}: {error}")))?;
        let mut document: FitDocument = migrate_fit_document(value, "")?;
        if document.id.is_empty() {
            return Err(FormatError::new("MISSING_FIT_ID", format!("Fit document in {path} has no id")));
        }
        let folder = path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("");
        document.folder = if folder.is_empty() { None } else {
            Some(folder.split('/').map(str::trim).filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/"))
        };
        library.fits.insert(document.id.clone(), document);
    }
    Ok(library)
}

pub fn write_directory(path: impl AsRef<Path>, library: &Library) -> Result<(), FormatError> {
    let root = path.as_ref();
    fs::create_dir_all(root).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
    for file in to_files(library)? {
        let target = root.join(&file.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
        }
        fs::write(target, file.text).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
    }
    Ok(())
}

fn collect_directory_files(root: &Path, directory: &Path, files: &mut Vec<FormatFile>) -> Result<(), FormatError> {
    let entries = fs::read_dir(directory).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
        let kind = entry.file_type().map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
        let path = entry.path();
        if kind.is_dir() {
            collect_directory_files(root, &path, files)?;
        } else if kind.is_file() {
            let relative = path.strip_prefix(root).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
            let relative = relative.to_string_lossy().replace('\\', "/");
            let is_group = relative.starts_with(&format!("{GROUP_DIR}/")) && relative.ends_with(".json");
            if relative == INDEX_PATH || relative.ends_with(".exfa.json") || is_group {
                let text = fs::read_to_string(path).map_err(|error| FormatError::new("IO_ERROR", error.to_string()))?;
                files.push(FormatFile { path: relative, text });
            }
        }
    }
    Ok(())
}

pub fn read_directory(path: impl AsRef<Path>) -> Result<Library, FormatError> {
    let root = path.as_ref();
    let mut files = Vec::new();
    collect_directory_files(root, root, &mut files)?;
    from_files(&files)
}
