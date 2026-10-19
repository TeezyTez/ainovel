//! Budget profile negotiation; never authorization. Generated contract owns both peers.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[path = "capacity_profile_generated.rs"]
pub mod generated;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    records: usize,
    unclosed: usize,
    payload_bytes: usize,
    frame_bytes: usize,
}
impl Limits {
    pub const fn legacy() -> Self {
        Self {
            records: generated::LEGACY_LEDGER_RECORDS,
            unclosed: generated::LEGACY_LEDGER_UNCLOSED,
            payload_bytes: generated::FRAME_MAX_BYTES,
            frame_bytes: generated::FRAME_MAX_BYTES,
        }
    }
    pub fn records(self) -> usize {
        self.records
    }
    pub fn unclosed(self) -> usize {
        self.unclosed
    }
    pub fn payload_bytes(self) -> usize {
        self.payload_bytes
    }
    pub fn frame_bytes(self) -> usize {
        self.frame_bytes
    }
    pub fn is_bounded(self) -> bool {
        self.unclosed != generated::LEGACY_LEDGER_UNCLOSED
    }
}

// Field order is the canonical UTF-8 JSON encoding also used by Go. Unknown fields
// and unknown versions/digests never negotiate increased capacity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Offer {
    version: u32,
    phase: String,
    contract_digest: String,
    scope: String,
    frame_max_bytes: u32,
    model_output_max_bytes: u32,
    context_token_limit: u32,
    output_token_reserve: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Accepted {
    version: u32,
    phase: String,
    contract_digest: String,
    offer_digest: String,
}

pub fn offer(
    scope: &str,
    context: u32,
    reserve: u32,
    verified: bool,
    frame_max: u32,
) -> Option<String> {
    if !verified
        || context == 0
        || reserve == 0
        || context <= reserve
        || scope.len() > 1024
        || frame_max == 0
        || frame_max as usize > generated::FRAME_MAX_BYTES
    {
        return None;
    }
    serde_json::to_string(&Offer {
        version: 1,
        phase: "offer".into(),
        contract_digest: generated::CONTRACT_DIGEST.into(),
        scope: format!("{:x}", Sha256::digest(scope.as_bytes())),
        frame_max_bytes: frame_max,
        model_output_max_bytes: generated::MODEL_OUTPUT_MAX_BYTES as u32,
        context_token_limit: context,
        output_token_reserve: reserve,
    })
    .ok()
}

/// Called only with the Backend-owned Facts and enclosing request scope, not model text.
/// The second return value is an independently computed accepted acknowledgement.
pub fn receive_offer(
    raw: &str,
    scope: &str,
    context: u32,
    reserve: u32,
    verified: bool,
) -> (Limits, Option<String>) {
    let legacy = (Limits::legacy(), None);
    if raw.len() > 4096 {
        return legacy;
    }
    let Ok(value) = serde_json::from_str::<Offer>(raw) else {
        return legacy;
    };
    let Some(expected) = offer(scope, context, reserve, verified, value.frame_max_bytes) else {
        return legacy;
    };
    let Ok(expected) = serde_json::from_str::<Offer>(&expected) else {
        return legacy;
    };
    if value != expected {
        return legacy;
    }
    let canonical = serde_json::to_vec(&expected).expect("canonical offer");
    let digest = format!("{:x}", Sha256::digest(&canonical));
    let ack = Accepted {
        version: 1,
        phase: "accepted".into(),
        contract_digest: generated::CONTRACT_DIGEST.into(),
        offer_digest: digest,
    };
    let payload_bytes =
        (value.frame_max_bytes as usize).min(generated::BOUNDED_LEDGER_PAYLOAD_MAX_BYTES);
    let records = payload_bytes / generated::BOUNDED_MINIMUM_OBLIGATION_WIRE_BYTES;
    (
        Limits {
            records,
            unclosed: records,
            payload_bytes,
            frame_bytes: value.frame_max_bytes as usize,
        },
        serde_json::to_string(&ack).ok(),
    )
}

pub fn matching_echo(
    raw: &str,
    acknowledgement: &str,
    scope: &str,
    context: u32,
    reserve: u32,
    verified: bool,
) -> Option<Limits> {
    let (limits, ack) = receive_offer(raw, scope, context, reserve, verified);
    let expected = ack?;
    let received: Accepted = serde_json::from_str(acknowledgement).ok()?;
    let expected: Accepted = serde_json::from_str(&expected).ok()?;
    if received != expected {
        return None;
    }
    Some(limits)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_is_legacy_and_offer_is_not_an_ack() {
        let raw = offer("f/c/1", 32768, 4096, true, 1048576).unwrap();
        let (limits, ack) = receive_offer(&raw, "f/c/1", 32768, 4096, true);
        assert!(limits.unclosed() > 16);
        assert!(matching_echo(&raw, &raw, "f/c/1", 32768, 4096, true).is_none());
        assert!(matching_echo(&raw, &ack.unwrap(), "f/c/1", 32768, 4096, true).is_some());
        assert_eq!(
            receive_offer(
                &raw.replace(generated::CONTRACT_DIGEST, "unknown"),
                "f/c/1",
                32768,
                4096,
                true
            )
            .0,
            Limits::legacy()
        );
        assert_eq!(
            receive_offer(&raw, "other", 32768, 4096, true).0,
            Limits::legacy()
        );
        assert!(offer("f/c/1", 32768, 4096, false, 1048576).is_none());
        assert!(offer("f/c/1", 32768, 4096, true, 1048577).is_none());
    }
}
