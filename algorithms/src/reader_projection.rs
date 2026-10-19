use serde::{Deserialize, Serialize};

/// Evidence-only attachments on immutable facts; never an executable client program.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReaderRecord {
    pub kind: String,
    pub entity_id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub target_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub value: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unit: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub status: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub bearing: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_meters: Option<u64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub passage: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub due_at: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<ReaderField>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReaderField {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub value: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default)]
    pub required: bool,
}
impl ReaderRecord {
    pub fn valid(&self) -> bool {
        let mut ids = std::collections::HashSet::new();
        matches!(self.kind.as_str(), "location"|"route"|"metric"|"schedule"|"item"|"action"|"artifact")
            && !self.label.trim().is_empty()
            && !self.entity_id.trim().is_empty()
            && matches!(self.bearing.as_str(), ""|"N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW")
            && matches!(self.passage.as_str(), ""|"open"|"blocked"|"unknown")
            && (self.kind != "route" || (!self.target_id.is_empty() && self.target_id != self.entity_id))
            && (self.kind != "action" || !self.input.trim().is_empty())
            && self.columns.len() <= 12 && self.rows.len() <= 100 && self.fields.len() <= 20
            && self.rows.iter().all(|r| r.len() == self.columns.len())
            && self.fields.iter().all(|f| !f.id.is_empty() && ids.insert(&f.id) && !f.label.trim().is_empty()
                && matches!(f.kind.as_str(), "text"|"number"|"select"|"checkbox")
                && f.options.len() <= 30 && (f.kind != "select" || !f.options.is_empty()))
    }
}
