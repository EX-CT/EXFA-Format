pub mod compute;
pub mod files;
pub mod group;
pub mod migrate;
pub mod package;
pub mod resolve;
pub mod types;
mod util;

use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormatError {
    pub code: String,
    pub message: String,
}

impl FormatError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl Display for FormatError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FormatError {}

pub use compute::compute_request;
pub use files::{from_files, read_directory, to_files, write_directory, FormatFile};
pub use group::{compile_group, new_group, CompiledGroup};
pub use migrate::{migrate, migrate_fit_document};
pub use package::{merge_package, package_fit, package_group, ConflictPolicy, MergePolicy};
pub use resolve::{resolve, resolve_fit_document, resolve_with_options, scenario_request, ResolveOptions};
pub use types::{
    Alternative, AlternativeOption, Branch, Character, DamagePattern, Environment, Fit,
    FitCargo, FitDocument, FitDrone, FitFighter, FitLinks, FitModule, FitOptions, FitRefs,
    Fleet, FleetBuff, FleetMember, Group, GroupActor, GroupRelation, GroupRelationKind,
    HistoryEntry, Library, ModState, Mutation, Override, Package, PackageRoot, PackageRootKind,
    Presence, ProjectedFitLink, ProjectedItem, Scenario, Security, Ship, Slot, SdeRef,
    TargetProfile, Workspace,
};
