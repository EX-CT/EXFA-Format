use crate::resolve::{apply_branch, resolve_fit_document, ResolveOptions};
use crate::types::{FitDocument, Library};
use crate::FormatError;
use serde_json::{json, Value};

/// Resolves a host document into an `exfa/compute@1` `calc` request envelope (FitSpec inside).
pub fn compute_request(library: &Library, document: &FitDocument, options: ResolveOptions) -> Result<Value, FormatError> {
    let effective = match &options.branch {
        Some(branch) => apply_branch(document, branch)?,
        None => document.clone(),
    };
    let fit = resolve_fit_document(&effective, library, 0)?;
    Ok(json!({ "format": "exfa/compute@1", "operation": "calc", "fit": fit }))
}
