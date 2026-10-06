pub mod files;
pub mod migrate;
pub mod resolve;
pub mod types;

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

pub use files::{from_files, read_directory, to_files, write_directory, FormatFile};
pub use migrate::{migrate, migrate_fit_document};
pub use resolve::{resolve, resolve_fit_document, resolve_with_options, scenario_request, ResolveOptions};
pub use types::{
    Alternative, AlternativeOption, Branch, Character, DamagePattern, Environment, Fit,
    FitCargo, FitDocument, FitDrone, FitFighter, FitLinks, FitModule, FitOptions, FitRefs,
    Fleet, FleetBuff, FleetMember, HistoryEntry, Library, ModState, Mutation, Override,
    Presence, ProjectedFitLink, ProjectedItem, Scenario, Security, Ship, Slot, SdeRef,
    TargetProfile,
};
