//! ElseLife product-only experience contracts, validation and shared process budgets.
//! Transport/listening belongs exclusively to the official runtime binaries.
pub mod experience;
pub mod capacity;
pub mod capacity_profile;

pub use capacity::{
    HANDLE_TIMEOUT_MS, MAX_FRAME_BYTES, MAX_INFLIGHT_FRAMES, MAX_INFLIGHT_MODEL, MAX_INFLIGHT_TOOL,
};
