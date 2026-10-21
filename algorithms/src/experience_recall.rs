//! Frozen generation coverage and typed raw recall evidence. No authority writer or search implementation.
use super::*;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Audience {
    Author,
    Reader,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum CoveragePolicy {
    #[serde(rename = "full.v1")]
    Full,
    #[serde(rename = "rules-secrets-open-recent-closure.v1")]
    Bounded,
    #[serde(rename = "stage-scene-selection.v1")]
    Scene,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(deny_unknown_fields)]
pub struct StateCounts {
    pub facts: u64,
    pub entities: u64,
    pub threads: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StateCoverage {
    pub policy: CoveragePolicy,
    pub recent_from_revision: u64,
    pub total: StateCounts,
    pub omitted: StateCounts,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub omitted_reader_known: Option<StateCounts>,
    pub complete: bool,
    pub source_handle: String,
    pub audience: Audience,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadBudget {
    pub max_reads: u64,
    pub max_reply_bytes: u64,
    pub max_total_reply_bytes: u64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ObjectType {
    Fact,
    Entity,
    Thread,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiteralMatch {
    All,
    Any,
}
pub(super) fn nullable_revision<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<u64>>, D::Error> {
    Option::<u64>::deserialize(d).map(Some)
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadTarget {
    #[serde(rename = "type")]
    pub object_type: ObjectType,
    pub id: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub at_revision: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReadSelector {
    Objects {
        objects: Vec<ReadTarget>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        cursor: Option<String>,
    },
    Names {
        #[serde(rename = "type")]
        object_type: ObjectType,
        names: Vec<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        at_revision: Option<u64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        cursor: Option<String>,
    },
    Pages {
        from_revision: u64,
        to_revision: u64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        cursor: Option<String>,
    },
    Enumerate {
        #[serde(rename = "type")]
        object_type: ObjectType,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        fact_kind: Option<FactKind>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        terms: Option<Vec<String>>,
        #[serde(
            rename = "match",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        literal_match: Option<LiteralMatch>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        from_source_revision: Option<u64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        to_source_revision: Option<u64>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        cursor: Option<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadRequest {
    pub request_id: String,
    pub source_handle: String,
    pub selector: ReadSelector,
    pub max_reply_bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ReadBody {
    Fact(Fact),
    Entity(Entity),
    Thread(Thread),
}
impl ReadBody {
    pub fn id(&self) -> &str {
        match self {
            Self::Fact(f) => &f.id,
            Self::Entity(e) => &e.id,
            Self::Thread(t) => &t.id,
        }
    }
    pub fn object_type(&self) -> ObjectType {
        match self {
            Self::Fact(_) => ObjectType::Fact,
            Self::Entity(_) => ObjectType::Entity,
            Self::Thread(_) => ObjectType::Thread,
        }
    }
    fn known(&self) -> bool {
        match self {
            Self::Fact(f) => f.known,
            Self::Entity(e) => e.known,
            Self::Thread(t) => t.known,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadObject {
    #[serde(rename = "type")]
    pub object_type: ObjectType,
    pub as_of_revision: u64,
    pub body: ReadBody,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadReceipt {
    pub query_sha256: String,
    pub body_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadReply {
    pub request_id: String,
    pub source_handle: String,
    pub experience_id: String,
    pub branch_id: String,
    pub base_revision: u64,
    pub audience: Audience,
    pub objects: Vec<ReadObject>,
    pub pages: Vec<Page>,
    pub complete: bool,
    // Required nullable field; Option alone would also accept a missing field.
    pub next_cursor: Value,
    pub receipt: ReadReceipt,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReadError {
    RecallBudgetExhausted,
    RecallItemCapacity,
    RecallScopeMismatch,
    RecallRevisionUnavailable,
    RecallQueryIncomplete,
}
impl ReadError {
    pub fn reason(self) -> &'static str {
        match self {
            Self::RecallBudgetExhausted => "recall_budget_exhausted",
            Self::RecallItemCapacity => "recall_item_capacity",
            Self::RecallScopeMismatch => "recall_scope_mismatch",
            Self::RecallRevisionUnavailable => "recall_revision_unavailable",
            Self::RecallQueryIncomplete => "recall_query_incomplete",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadFailure {
    pub request_id: String,
    pub error_code: ReadError,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ReadResult {
    Reply(ReadReply),
    Failure(ReadFailure),
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum GenerationResult {
    Candidate(Candidate),
    ReadRequest(ReadRequest),
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GenerationOutput {
    pub result: GenerationResult,
}
impl GenerationOutput {
    pub fn decode(raw: &[u8], c: &Context) -> Checked<Self> {
        require(
            raw.len() <= crate::capacity::MAX_MODEL_OUTPUT_BYTES,
            "candidate_budget_exceeded",
        )?;
        let out: Self =
            serde_json::from_slice(raw).map_err(|_| Invalid("invalid_generation_json"))?;
        match &out.result {
            GenerationResult::Candidate(n) => n.validate(c)?,
            GenerationResult::ReadRequest(r) => r.validate(c)?,
        }
        Ok(out)
    }
}
impl StateCoverage {
    pub fn validate(&self, c: &Context) -> Checked<()> {
        require(nonempty(&self.source_handle), "recall_scope_mismatch")?;
        require(
            self.audience
                == if c.mode == Mode::Ask {
                    Audience::Reader
                } else {
                    Audience::Author
                },
            "coverage_audience_mismatch",
        )?;
        let included = [
            c.state.facts.len() as u64,
            c.state.entities.len() as u64,
            c.state.threads.len() as u64,
        ];
        let omitted = [
            self.omitted.facts,
            self.omitted.entities,
            self.omitted.threads,
        ];
        let total = [self.total.facts, self.total.entities, self.total.threads];
        for i in 0..3 {
            require(
                included[i].checked_add(omitted[i]) == Some(total[i]),
                "coverage_count_mismatch",
            )?;
        }
        require(
            self.complete == omitted.iter().all(|n| *n == 0),
            "coverage_complete_mismatch",
        )?;
        require(
            self.recent_from_revision <= c.revision,
            "coverage_future_revision",
        )?;
        if self.policy == CoveragePolicy::Full {
            require(
                self.complete && self.recent_from_revision == 0,
                "coverage_policy_mismatch",
            )?;
        }
        if let Some(k) = &self.omitted_reader_known {
            let known = [k.facts, k.entities, k.threads];
            for i in 0..3 {
                require(
                    known[i] <= omitted[i]
                        && (self.audience != Audience::Reader || known[i] == omitted[i]),
                    "coverage_reader_count_mismatch",
                )?;
            }
        }
        if self.audience == Audience::Reader {
            require(
                c.state.facts.iter().all(|f| f.known)
                    && c.state.entities.iter().all(|e| e.known)
                    && c.state.threads.iter().all(|t| t.known),
                "reader_hidden_object",
            )?;
        }
        Ok(())
    }
}
impl ReadRequest {
    pub fn validate(&self, c: &Context) -> Checked<()> {
        require(
            nonempty(&self.request_id) && self.source_handle == c.state_coverage.source_handle,
            "recall_scope_mismatch",
        )?;
        require(
            self.max_reply_bytes > 0
                && self.max_reply_bytes <= c.read_budget.max_reply_bytes
                && self.max_reply_bytes <= c.read_budget.max_total_reply_bytes,
            "recall_budget_exhausted",
        )?;
        let revision = |r: Option<u64>| {
            require(
                r.is_none_or(|r| r > 0 && r <= c.revision),
                "recall_revision_unavailable",
            )
        };
        match &self.selector {
            ReadSelector::Objects { objects, .. } => {
                require(
                    !objects.is_empty() && objects.iter().all(|o| nonempty(&o.id)),
                    "recall_query_incomplete",
                )?;
                for o in objects {
                    revision(o.at_revision)?;
                }
            }
            ReadSelector::Names {
                object_type,
                names,
                at_revision,
                ..
            } => {
                require(
                    *object_type == ObjectType::Entity
                        && !names.is_empty()
                        && names.iter().all(|n| nonempty(n)),
                    "recall_query_incomplete",
                )?;
                revision(*at_revision)?;
            }
            ReadSelector::Pages {
                from_revision,
                to_revision,
                ..
            } => {
                require(
                    *from_revision > 0
                        && from_revision <= to_revision
                        && *to_revision <= c.revision,
                    "recall_revision_unavailable",
                )?;
            }
            ReadSelector::Enumerate {
                object_type,
                fact_kind,
                terms,
                literal_match,
                from_source_revision,
                to_source_revision,
                ..
            } => {
                require(
                    *object_type == ObjectType::Fact
                        || (fact_kind.is_none()
                            && from_source_revision.is_none()
                            && to_source_revision.is_none()),
                    "recall_query_incomplete",
                )?;
                if let Some(terms) = terms {
                    require(
                        !terms.is_empty()
                            && terms.iter().all(|t| nonempty(t))
                            && literal_match.is_some(),
                        "recall_query_incomplete",
                    )?;
                }
                revision(*from_source_revision)?;
                revision(*to_source_revision)?;
                require(
                    !matches!((from_source_revision, to_source_revision), (Some(a), Some(b)) if a > b),
                    "recall_query_incomplete",
                )?;
            }
        }
        Ok(())
    }
}
/// D6 receipt recipe: sorted UTF-8 object keys, integer numbers, compact JSON, Go HTML/line escaping.
pub fn receipt_bytes(value: &Value) -> Vec<u8> {
    // serde_json's default Map is BTreeMap; no preserve_order feature is enabled in this crate.
    fn sorted(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let mut keys: Vec<_> = m.keys().collect();
                keys.sort();
                Value::Object(
                    keys.into_iter()
                        .map(|k| (k.clone(), sorted(&m[k])))
                        .collect(),
                )
            }
            Value::Array(a) => Value::Array(a.iter().map(sorted).collect()),
            _ => v.clone(),
        }
    }
    serde_json::to_string(&sorted(value))
        .expect("JSON value")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .into_bytes()
}
pub fn receipt_hash(value: &Value) -> String {
    format!("{:x}", Sha256::digest(receipt_bytes(value)))
}
impl ReadReply {
    pub fn body_hash(&self) -> String {
        let mut v = serde_json::to_value(self).expect("read reply");
        v.as_object_mut().unwrap().remove("receipt");
        receipt_hash(&v)
    }
    pub fn validate_evidence(&self, c: &Context) -> Checked<()> {
        require(
            nonempty(&self.request_id)
                && self.source_handle == c.state_coverage.source_handle
                && self.experience_id == c.experience_id
                && self.branch_id == c.branch_id
                && self.base_revision == c.revision
                && self.audience == c.state_coverage.audience,
            "recall_scope_mismatch",
        )?;
        require(
            (self.complete && self.next_cursor.is_null())
                || (!self.complete && self.next_cursor.as_str().is_some_and(nonempty)),
            "recall_query_incomplete",
        )?;
        let hash = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        require(
            hash(&self.receipt.query_sha256) && self.receipt.body_sha256 == self.body_hash(),
            "recall_receipt_mismatch",
        )?;
        let mut objects = HashSet::new();
        for o in &self.objects {
            require(
                o.as_of_revision > 0 && o.as_of_revision <= c.revision,
                "recall_revision_unavailable",
            )?;
            require(
                o.object_type == o.body.object_type()
                    && nonempty(o.body.id())
                    && objects.insert((o.object_type, o.body.id(), o.as_of_revision)),
                "recall_object_mismatch",
            )?;
            if self.audience == Audience::Reader {
                require(o.body.known(), "reader_hidden_object")?;
            }
            match &o.body {
                ReadBody::Fact(f) => {
                    require(
                        nonempty(&f.text) && f.source_revision <= o.as_of_revision,
                        "future_fact_revision",
                    )?;
                    require(
                        self.audience == Audience::Reader
                            || !matches!(f.kind, FactKind::Statement | FactKind::Belief)
                            || nonempty(&f.subject_id),
                        "unattributed_character_claim",
                    )?;
                    unique(f.known_by.iter().map(String::as_str))?;
                }
                ReadBody::Entity(e) => {
                    require(nonempty(&e.name), "empty_entity_name")?;
                    unique(e.related_ids.iter().map(String::as_str))?;
                }
                ReadBody::Thread(t) => {
                    require(nonempty(&t.text), "empty_thread_text")?;
                    require(
                        t.resolved_at_revision
                            .flatten()
                            .is_none_or(|r| r > 0 && r <= o.as_of_revision),
                        "future_thread_revision",
                    )?;
                    unique(t.related_fact_ids.iter().map(String::as_str))?;
                }
            }
            // A current-base reply is evidence for an omitted object, never a rewrite of a supplied body.
            if o.as_of_revision == c.revision {
                let same = match &o.body {
                    ReadBody::Fact(f) => {
                        c.state.facts.iter().find(|x| x.id == f.id).map(|x| x == f)
                    }
                    ReadBody::Entity(e) => c
                        .state
                        .entities
                        .iter()
                        .find(|x| x.id == e.id)
                        .map(|x| x == e),
                    ReadBody::Thread(t) => c
                        .state
                        .threads
                        .iter()
                        .find(|x| x.id == t.id)
                        .map(|x| x == t),
                };
                require(same != Some(false), "recall_current_body_mismatch")?;
            }
        }
        let mut revisions = HashSet::new();
        for p in &self.pages {
            validate_page(p)?;
            require(
                p.revision <= c.revision && revisions.insert(p.revision),
                "recall_revision_unavailable",
            )?;
            require(
                !c.history.iter().any(|x| x.revision == p.revision && x != p),
                "recall_page_body_mismatch",
            )?;
        }
        Ok(())
    }
    pub fn validate(&self, c: &Context, r: &ReadRequest, raw: &[u8]) -> Checked<()> {
        self.validate_evidence(c)?;
        require(
            self.request_id == r.request_id
                && self.receipt.query_sha256 == receipt_hash(&serde_json::to_value(r).unwrap()),
            "recall_receipt_mismatch",
        )?;
        require(
            raw.len() as u64 <= r.max_reply_bytes && raw.len() as u64 <= c.read_budget.max_reply_bytes,
            "recall_item_capacity",
        )?;
        // Predicate validation catches unrelated/future snapshots without treating receipts as authorization.
        match &r.selector {
            ReadSelector::Pages {
                from_revision,
                to_revision,
                ..
            } => {
                require(
                    self.objects.is_empty()
                        && self
                            .pages
                            .iter()
                            .all(|p| p.revision >= *from_revision && p.revision <= *to_revision),
                    "recall_object_mismatch",
                )?;
            }
            ReadSelector::Objects { objects, .. } => {
                require(
                    self.pages.is_empty()
                        && self.objects.iter().all(|o| {
                            objects.iter().any(|t| {
                                t.object_type == o.object_type
                                    && t.id == o.body.id()
                                    && t.at_revision.unwrap_or(c.revision) == o.as_of_revision
                            })
                        }),
                    "recall_object_mismatch",
                )?;
            }
            ReadSelector::Names {
                names, at_revision, ..
            } => {
                require(
                    self.pages.is_empty()
                        && self.objects.iter().all(|o| {
                            o.as_of_revision == at_revision.unwrap_or(c.revision)
                                && matches!(&o.body, ReadBody::Entity(e) if names.contains(&e.name))
                        }),
                    "recall_object_mismatch",
                )?;
            }
            ReadSelector::Enumerate {
                object_type,
                fact_kind,
                terms,
                literal_match,
                from_source_revision,
                to_source_revision,
                ..
            } => {
                require(
                    self.pages.is_empty()
                        && self.objects.iter().all(|o| {
                            if o.object_type != *object_type || o.as_of_revision != c.revision {
                                return false;
                            }
                            let text = match &o.body {
                                ReadBody::Fact(f) => {
                                    if fact_kind.is_some_and(|k| k != f.kind)
                                        || from_source_revision
                                            .is_some_and(|n| f.source_revision < n)
                                        || to_source_revision.is_some_and(|n| f.source_revision > n)
                                    {
                                        return false;
                                    }
                                    f.text.clone()
                                }
                                ReadBody::Entity(e) => format!("{}{}", e.name, e.description),
                                ReadBody::Thread(t) => t.text.clone(),
                            };
                            terms.as_ref().is_none_or(|terms| match literal_match {
                                Some(LiteralMatch::All) => terms.iter().all(|t| text.contains(t)),
                                Some(LiteralMatch::Any) => terms.iter().any(|t| text.contains(t)),
                                None => false,
                            })
                        }),
                    "recall_object_mismatch",
                )?;
            }
        }
        Ok(())
    }
}
pub(super) fn validate_page(p: &Page) -> Checked<()> {
    require(p.revision > 0 && nonempty(&p.text), "history_revision_gap")?;
    require(
        (p.revision == 1) == (p.mode == Mode::Begin),
        "invalid_history_mode",
    )?;
    require(
        !matches!(p.mode, Mode::Act | Mode::Ask) || nonempty(&p.input),
        "invalid_history_input",
    )
}
/// Only current-base evidence participates in ID checks. Historical objects remain separate snapshots.
pub(super) fn current_evidence(c: &Context) -> Checked<State> {
    let mut state = c.state.clone();
    for reply in &c.recalls {
        for o in &reply.objects {
            if o.as_of_revision != c.revision {
                continue;
            }
            match &o.body {
                ReadBody::Fact(f) => {
                    if let Some(x) = state.facts.iter().find(|x| x.id == f.id) {
                        require(x == f, "recall_current_body_mismatch")?;
                    } else {
                        state.facts.push(f.clone());
                    }
                }
                ReadBody::Entity(e) => {
                    if let Some(x) = state.entities.iter().find(|x| x.id == e.id) {
                        require(x == e, "recall_current_body_mismatch")?;
                    } else {
                        state.entities.push(e.clone());
                    }
                }
                ReadBody::Thread(t) => {
                    if let Some(x) = state.threads.iter().find(|x| x.id == t.id) {
                        require(x == t, "recall_current_body_mismatch")?;
                    } else {
                        state.threads.push(t.clone());
                    }
                }
            }
        }
    }
    state_ids(&state)?;
    require(
        state.facts.len() as u64 <= c.state_coverage.total.facts
            && state.entities.len() as u64 <= c.state_coverage.total.entities
            && state.threads.len() as u64 <= c.state_coverage.total.threads,
        "coverage_count_mismatch",
    )?;
    Ok(state)
}
