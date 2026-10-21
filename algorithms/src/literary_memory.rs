//! Source-bound literary index. Interpretations are author material, never character knowledge.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LiteraryMemory {
    pub version: u32,
    pub indexed_through_revision: u64,
    pub entries: Vec<MemoryEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MemoryChange {
    pub id: String,
    pub kind: String,
    pub subject_ids: Vec<String>,
    pub target_ids: Vec<String>,
    pub cue: String,
    pub summary: String,
    pub status: String,
    pub retrieval_keys: Vec<String>,
    pub fact_ids: Vec<String>,
    pub quote: String,
}

/// The model proposes an interpretation, never a durable origin or permission.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MemoryInterpretation {
    pub id: String,
    pub kind: String,
    pub subject_ids: Vec<String>,
    pub target_ids: Vec<String>,
    pub cue: String,
    pub summary: String,
    pub status: String,
    pub retrieval_keys: Vec<String>,
    pub fact_ids: Vec<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_option"
    )]
    pub locator_quote: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MemoryDelta {
    pub version: u32,
    pub entries: Vec<MemoryInterpretation>,
}

/// Missing optional fields are compatible; explicit null is not a representation.
pub(super) fn present_option<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LegacyMemoryEntry {
    pub id: String,
    pub kind: String,
    pub subject_ids: Vec<String>,
    pub target_ids: Vec<String>,
    pub cue: String,
    pub summary: String,
    pub status: String,
    pub retrieval_keys: Vec<String>,
    pub fact_ids: Vec<String>,
    pub quote: String,
    pub source_revision: u64,
    pub source_sha256: String,
    pub updated_revision: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prior_sources: Vec<MemorySource>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MemoryEvidenceRef {
    FormalPage {
        revision: u64,
        text_sha256: String,
    },
    AuthorityFact {
        fact_id: String,
        as_of_revision: u64,
        record_sha256: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourcedMemoryEntry {
    pub id: String,
    pub kind: String,
    pub subject_ids: Vec<String>,
    pub target_ids: Vec<String>,
    pub cue: String,
    pub summary: String,
    pub status: String,
    pub retrieval_keys: Vec<String>,
    pub fact_ids: Vec<String>,
    pub updated_revision: u64,
    pub evidence_refs: Vec<MemoryEvidenceRef>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_option"
    )]
    pub locator_quote: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_option"
    )]
    pub legacy_entry: Option<LegacyMemoryEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "evidence_kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VersionedMemoryEntry {
    LegacyV1(LegacyMemoryEntry),
    SourceRefsV2(SourcedMemoryEntry),
}

/// Old states stay byte-shape compatible; version 2 requires an explicit marker.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum MemoryEntry {
    Versioned(VersionedMemoryEntry),
    Legacy(LegacyMemoryEntry),
}

/// Go stamps the immutable sources retained when an indexed interpretation changes.
/// This type is deliberately absent from the model-writable MemoryChange.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MemorySource {
    pub revision: u64,
    pub sha256: String,
    pub quote: String,
}

fn bounded_text(value: &str, max: usize) -> bool {
    nonempty(value) && value.chars().count() <= max
}
fn memory_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
fn source_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl MemoryChange {
    fn validate(&self, state: &State, deferred: bool) -> Checked<()> {
        self.interpretation().validate(state, deferred)?;
        require(bounded_text(&self.quote, 2048), "invalid_literary_memory")
    }
    fn interpretation(&self) -> MemoryInterpretation {
        MemoryInterpretation {
            id: self.id.clone(),
            kind: self.kind.clone(),
            subject_ids: self.subject_ids.clone(),
            target_ids: self.target_ids.clone(),
            cue: self.cue.clone(),
            summary: self.summary.clone(),
            status: self.status.clone(),
            retrieval_keys: self.retrieval_keys.clone(),
            fact_ids: self.fact_ids.clone(),
            locator_quote: None,
        }
    }
}
impl MemoryInterpretation {
    fn validate(&self, state: &State, deferred: bool) -> Checked<()> {
        require(
            memory_id(&self.id)
                && matches!(
                    self.kind.as_str(),
                    "disposition"
                        | "goal"
                        | "relationship"
                        | "episode"
                        | "commitment"
                        | "expression"
                        | "object"
                        | "thread"
                )
                && matches!(self.status.as_str(), "active" | "resolved" | "revised")
                && (1..=8).contains(&self.subject_ids.len())
                && self.target_ids.len() <= 8
                && bounded_text(&self.cue, 256)
                && bounded_text(&self.summary, 2048)
                && self
                    .locator_quote
                    .as_ref()
                    .map_or(true, |q| bounded_text(q, 2048))
                && self.retrieval_keys.len() <= 12
                && self.retrieval_keys.iter().all(|v| bounded_text(v, 128))
                && self.fact_ids.len() <= 64,
            "invalid_literary_memory",
        )?;
        let all = state_ids(state)?;
        let subjects = state
            .entities
            .iter()
            .map(|e| e.id.as_str())
            .chain(state.threads.iter().map(|t| t.id.as_str()))
            .collect();
        let facts = state.facts.iter().map(|f| f.id.as_str()).collect();
        for ids in [&self.subject_ids, &self.target_ids] {
            require(
                ids.iter().all(|id| memory_id(id)),
                "invalid_literary_memory",
            )?;
            deferred_references(ids.iter().map(String::as_str), &subjects, &all, deferred)?;
        }
        require(
            self.fact_ids.iter().all(|id| memory_id(id)),
            "invalid_literary_memory",
        )?;
        deferred_references(
            self.fact_ids.iter().map(String::as_str),
            &facts,
            &all,
            deferred,
        )?;
        unique(self.retrieval_keys.iter().map(String::as_str))?;
        Ok(())
    }
}
impl LegacyMemoryEntry {
    fn change(&self) -> MemoryChange {
        MemoryChange {
            id: self.id.clone(),
            kind: self.kind.clone(),
            subject_ids: self.subject_ids.clone(),
            target_ids: self.target_ids.clone(),
            cue: self.cue.clone(),
            summary: self.summary.clone(),
            status: self.status.clone(),
            retrieval_keys: self.retrieval_keys.clone(),
            fact_ids: self.fact_ids.clone(),
            quote: self.quote.clone(),
        }
    }
    fn validate(&self, state: &State, revision: u64, deferred: bool) -> Checked<()> {
        self.change().validate(state, deferred)?;
        require(
            self.source_revision > 0
                && self.source_revision == self.updated_revision
                && self.updated_revision <= revision
                && source_hash(&self.source_sha256)
                && state
                    .facts
                    .iter()
                    .filter(|f| self.fact_ids.contains(&f.id))
                    .all(|f| f.source_revision <= self.source_revision),
            "invalid_literary_memory_source",
        )?;
        let mut previous_revision = 0;
        for source in &self.prior_sources {
            require(
                source.revision > previous_revision
                    && source.revision < self.source_revision
                    && source_hash(&source.sha256)
                    && bounded_text(&source.quote, 2048),
                "invalid_literary_memory_source",
            )?;
            previous_revision = source.revision;
        }
        Ok(())
    }
}
impl SourcedMemoryEntry {
    fn interpretation(&self) -> MemoryInterpretation {
        MemoryInterpretation {
            id: self.id.clone(),
            kind: self.kind.clone(),
            subject_ids: self.subject_ids.clone(),
            target_ids: self.target_ids.clone(),
            cue: self.cue.clone(),
            summary: self.summary.clone(),
            status: self.status.clone(),
            retrieval_keys: self.retrieval_keys.clone(),
            fact_ids: self.fact_ids.clone(),
            locator_quote: self.locator_quote.clone(),
        }
    }
    fn validate(&self, state: &State, revision: u64, deferred: bool) -> Checked<()> {
        self.interpretation().validate(state, deferred)?;
        require(
            self.updated_revision > 0
                && self.updated_revision <= revision
                && !self.evidence_refs.is_empty(),
            "invalid_literary_memory_source",
        )?;
        let mut seen = HashSet::new();
        let mut current_page = false;
        for source in &self.evidence_refs {
            require(
                seen.insert(serde_json::to_string(source).unwrap()),
                "invalid_literary_memory_source",
            )?;
            match source {
                MemoryEvidenceRef::FormalPage {
                    revision,
                    text_sha256,
                } => {
                    require(
                        *revision > 0
                            && *revision <= self.updated_revision
                            && source_hash(text_sha256),
                        "invalid_literary_memory_source",
                    )?;
                    current_page |= *revision == self.updated_revision;
                }
                MemoryEvidenceRef::AuthorityFact {
                    fact_id,
                    as_of_revision,
                    record_sha256,
                } => {
                    require(
                        memory_id(fact_id)
                            && *as_of_revision > 0
                            && *as_of_revision <= self.updated_revision
                            && source_hash(record_sha256),
                        "invalid_literary_memory_source",
                    )?;
                }
            }
        }
        require(current_page, "invalid_literary_memory_source")?;
        if let Some(old) = &self.legacy_entry {
            old.validate(state, self.updated_revision, deferred)?;
            require(
                same_identity(&old.change().interpretation(), &self.interpretation()),
                "memory_identity_changed",
            )?;
        }
        // Full page/fact existence, branch identity and hashes are Go authority.
        Ok(())
    }
}
impl MemoryEntry {
    fn interpretation(&self) -> MemoryInterpretation {
        match self {
            Self::Legacy(old) | Self::Versioned(VersionedMemoryEntry::LegacyV1(old)) => {
                old.change().interpretation()
            }
            Self::Versioned(VersionedMemoryEntry::SourceRefsV2(entry)) => entry.interpretation(),
        }
    }
    fn id(&self) -> &str {
        match self {
            Self::Legacy(old) | Self::Versioned(VersionedMemoryEntry::LegacyV1(old)) => &old.id,
            Self::Versioned(VersionedMemoryEntry::SourceRefsV2(entry)) => &entry.id,
        }
    }
}
impl LiteraryMemory {
    pub fn validate(&self, state: &State, revision: u64, deferred: bool) -> Checked<()> {
        require(
            matches!(self.version, 1 | 2) && self.indexed_through_revision <= revision,
            "literary_memory_revision_mismatch",
        )?;
        unique(self.entries.iter().map(MemoryEntry::id))?;
        for entry in &self.entries {
            match (self.version, entry) {
                (1, MemoryEntry::Legacy(old))
                | (2, MemoryEntry::Versioned(VersionedMemoryEntry::LegacyV1(old))) => {
                    old.validate(state, revision, deferred)?;
                }
                (2, MemoryEntry::Versioned(VersionedMemoryEntry::SourceRefsV2(entry))) => {
                    entry.validate(state, revision, deferred)?;
                }
                _ => return Err(Invalid("invalid_literary_memory")),
            }
        }
        Ok(())
    }
}
pub(super) fn validate_memory_changes(
    candidate: &Candidate,
    c: &Context,
    state: &State,
) -> Checked<()> {
    require(
        !(candidate.memory_delta.is_some() && candidate.memory_changes.is_some()),
        "mixed_memory_representation",
    )?;
    if candidate.memory_delta.is_none() && candidate.memory_changes.is_none() {
        return Ok(());
    }
    require(c.mode != Mode::Ask, "ask_changes_world")?;
    let changes: Vec<MemoryInterpretation> = if let Some(delta) = &candidate.memory_delta {
        require(delta.version == 2, "invalid_literary_memory")?;
        delta.entries.clone()
    } else {
        let old = candidate.memory_changes.as_ref().unwrap();
        for change in old {
            require(bounded_text(&change.quote, 2048), "invalid_literary_memory")?;
            require(
                candidate.passage.contains(&change.quote),
                "memory_quote_mismatch",
            )?;
        }
        old.iter().map(MemoryChange::interpretation).collect()
    };
    require(changes.len() <= 12, "invalid_literary_memory")?;
    unique(changes.iter().map(|e| e.id.as_str()))?;
    let mut next = state.clone();
    next.entities.extend(candidate.new_entities.clone());
    next.facts.extend(candidate.new_facts.clone());
    next.threads.extend(candidate.new_threads.clone());
    for change in &changes {
        change.validate(&next, !c.state_coverage.complete)?;
        if let Some(locator) = &change.locator_quote {
            require(candidate.passage.contains(locator), "memory_quote_mismatch")?;
        }
        if let Some(old) = c
            .state
            .literary_memory
            .as_ref()
            .and_then(|m| m.entries.iter().find(|e| e.id() == change.id))
        {
            require(
                same_identity(&old.interpretation(), change),
                "memory_identity_changed",
            )?;
        }
    }
    Ok(())
}

fn same_identity(a: &MemoryInterpretation, b: &MemoryInterpretation) -> bool {
    let same_ids = |a: &[String], b: &[String]| {
        a.iter().collect::<HashSet<_>>() == b.iter().collect::<HashSet<_>>()
    };
    a.id == b.id
        && a.kind == b.kind
        && same_ids(&a.subject_ids, &b.subject_ids)
        && same_ids(&a.target_ids, &b.target_ids)
}
