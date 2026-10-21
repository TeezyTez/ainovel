//! Bounded narrative stages. Proposals and model reviews never replace Go's commit authority.
use super::*;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;
#[path = "narrative_extraction.rs"]
mod extraction;
#[path = "narrative_reading.rs"]
mod reading;

pub const MAX_CALLS: u32 = 12;
pub const MAX_CANDIDATE_BYTES: usize = 24 * 1024;
pub const MAX_NOTEBOOK_BYTES: usize = 12 * 1024;
pub const MAX_STAGE_SCHEMA_BYTES: usize = 20 * 1024;
/// A provider attempt carries one schema, natively or in JSON-mode instructions.
/// Include strict conversion and transport growth. Independent review carries
/// the frozen candidate and evidence, not unexecuted drafting proposals.
pub const MAX_STAGE_OVERHEAD_BYTES: usize = 36 * 1024;
pub const SCHEMA_TRANSPORT_GROWTH_BYTES: usize = 2 * 1024;
pub const MAX_INTERMEDIATE_BYTES: usize = 2 * 1024;

pub fn active_game(context: &Context) -> bool {
    context
        .state
        .gameplay
        .as_ref()
        .is_some_and(|g| !g["game"].is_null())
        || context
            .gameplay_action
            .as_ref()
            .is_some_and(|a| a["kind"] == "journey" || a["kind"] == "game")
}
pub fn stage_overhead_bytes(_context: &Context) -> usize {
    MAX_STAGE_OVERHEAD_BYTES
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SceneFrame {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_needs: Option<ContextNeeds>,
    pub actors: Vec<ActorTrigger>,
    pub relevant_fact_ids: Vec<String>,
    pub objective: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ContextNeeds {
    pub participant_ids: Vec<String>,
    pub relationship_targets: Vec<String>,
    pub topics: Vec<String>,
    pub open_questions: Vec<String>,
    pub fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActorTrigger {
    pub actor_id: String,
    pub trigger: String,
    pub fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActorDecision {
    pub actor_id: String,
    pub intent: String,
    pub action: String,
    pub speech: String,
    pub conditions: Vec<String>,
    pub used_fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlotCandidate {
    pub id: String,
    pub purpose: String,
    pub beats: Vec<String>,
    pub causes: Vec<String>,
    pub costs: Vec<String>,
    pub consequences: Vec<String>,
    pub thread_ids: Vec<String>,
    pub fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plans {
    pub candidates: Vec<PlotCandidate>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Evaluation {
    pub candidate_id: String,
    pub continuity: u32,
    pub agency: u32,
    pub causality: u32,
    pub consequence: u32,
    pub pacing: u32,
    pub interest: u32,
    pub blocking_issues: Vec<String>,
    pub evidence_fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Evaluations {
    pub evaluations: Vec<Evaluation>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub title: String,
    pub passage: String,
    pub story_time: String,
    pub outcome: Outcome,
    pub suggestions: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReviewIssue {
    pub code: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FactSupport {
    pub fact_id: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeSupport {
    pub subject_id: String,
    pub fact_id: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RevealSupport {
    #[serde(rename = "type")]
    pub object_type: ObjectType,
    pub id: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LegacyMemorySupport {
    pub memory_id: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MemorySourceSupport {
    pub memory_id: String,
    pub source_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum MemorySupport {
    Sources(MemorySourceSupport),
    Legacy(LegacyMemorySupport),
}
impl MemorySupport {
    fn memory_id(&self) -> &str {
        match self {
            Self::Sources(support) => &support.memory_id,
            Self::Legacy(support) => &support.memory_id,
        }
    }
    fn legacy_quote(&self) -> Option<&String> {
        match self {
            Self::Sources(_) => None,
            Self::Legacy(support) => Some(&support.quote),
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepairScope {
    None,
    CandidateState,
    Draft,
    Mixed,
    Undetermined,
}
fn deserialize_repair_scope<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<RepairScope>, D::Error> {
    // Missing is legacy; explicit null is malformed, not a legacy signal.
    RepairScope::deserialize(deserializer).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub approved: bool,
    #[serde(
        default,
        deserialize_with = "deserialize_repair_scope",
        skip_serializing_if = "Option::is_none"
    )]
    pub repair_scope: Option<RepairScope>,
    pub issues: Vec<ReviewIssue>,
    pub supports: Vec<FactSupport>,
    pub knowledge_supports: Vec<KnowledgeSupport>,
    #[serde(default)]
    pub reveal_supports: Vec<RevealSupport>,
    #[serde(default)]
    pub memory_supports: Vec<MemorySupport>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Extracted {
    // Preserve duplicate keys for typed domain decoding; never reserialize Value first.
    candidate: Box<RawValue>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultEnvelope<T> {
    result: T,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Stage {
    Memory,
    Actor,
    Plan,
    Evaluate,
    Write,
    Extract,
    RepairExtract,
    RepairState,
    Review,
    RepairReview,
    Revise,
    Answer,
    Done,
}
impl Stage {
    fn name(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::Actor => "actor",
            Self::Plan => "plan",
            Self::Evaluate => "evaluate",
            Self::Write => "write",
            Self::Extract => "extract",
            Self::RepairExtract => "repair_extract",
            Self::RepairState => "repair_state",
            Self::Review => "review",
            Self::RepairReview => "repair_review",
            Self::Revise => "revise",
            Self::Answer => "answer",
            Self::Done => "done",
        }
    }
}
#[derive(Clone, Debug)]
pub struct StageRequest {
    pub stage: &'static str,
    pub actor_id: String,
    pub prompt: String,
    pub schema: Value,
    pub input: Value,
}
#[derive(Debug)]
pub enum PipelineStep {
    Continue,
    Read(ReadRequest),
    Complete(Candidate),
}
pub struct Pipeline {
    stage: Stage,
    config: PipelineConfig,
    max_calls: u32,
    calls: u32,
    pending: bool,
    actor_index: usize,
    repairs: u32,
    scene: Option<SceneFrame>,
    actors: Vec<ActorDecision>,
    plans: Option<Plans>,
    selected: Option<PlotCandidate>,
    draft: Option<Draft>,
    candidate: Option<Candidate>,
    review: Option<Review>,
    repair_feedback: Option<Value>,
    extraction_error: Option<&'static str>,
    read_stages: HashSet<(Stage, usize, u32)>,
    stage_recall_start: usize,
}
impl Pipeline {
    pub fn new(context: &Context, grant: u32) -> Checked<Self> {
        context.validate()?;
        let config = context
            .pipeline
            .clone()
            .ok_or(Invalid("pipeline_config_required"))?;
        require(grant > 0, "model_budget_exhausted")?;
        Ok(Self {
            stage: if context.mode == Mode::Ask {
                Stage::Answer
            } else {
                Stage::Memory
            },
            config,
            max_calls: grant.min(MAX_CALLS),
            calls: 0,
            pending: false,
            actor_index: 0,
            repairs: 0,
            scene: None,
            actors: vec![],
            plans: None,
            selected: None,
            draft: None,
            candidate: None,
            review: None,
            repair_feedback: None,
            extraction_error: None,
            read_stages: HashSet::new(),
            stage_recall_start: 0,
        })
    }
    pub fn calls(&self) -> u32 {
        self.calls
    }
    /// Only closed public failure categories cross the Go boundary. Internal
    /// validator names remain useful to deterministic replay, never a protocol error.
    pub fn failure_reason(&self, error: Invalid) -> &'static str {
        match error.0 {
            "model_budget_exhausted" => "model_budget_exhausted",
            "stage_content_capacity" | "stage_schema_capacity" => "context_budget_exceeded",
            "stage_output_capacity" | "candidate_budget_exceeded" => "model_output_capacity",
            "extract_changed_draft" => "narrative_extraction_mismatch",
            "ask_changes_world" => "ask_mutation",
            "no_eligible_plot" => "narrative_plan_rejected",
            "narrative_review_rejected" => "narrative_review_rejected",
            _ => match self.stage {
                Stage::Extract | Stage::RepairExtract | Stage::RepairState => "invalid_candidate",
                Stage::Review | Stage::RepairReview => "narrative_review_rejected",
                _ => "narrative_stage_invalid",
            },
        }
    }
    pub fn next_request(&mut self, context: &Context) -> Checked<StageRequest> {
        require(
            !self.pending && self.stage != Stage::Done,
            "pipeline_stage_pending",
        )?;
        require(self.calls < self.max_calls, "model_budget_exhausted")?;
        context.validate()?;
        let (actor_id, input) = match self.stage {
            Stage::Actor => {
                let trigger = &self.scene.as_ref().unwrap().actors[self.actor_index];
                // No raw input, seed, notebook, author world or other actor decisions enter this call.
                (
                    trigger.actor_id.clone(),
                    serde_json::to_value(trigger).unwrap(),
                )
            }
            Stage::Memory | Stage::Answer => (
                String::new(),
                context_view(context, self.stage_recall_start)?,
            ),
            Stage::Plan => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,"scene":self.scene,"actors":self.actors}),
            ),
            Stage::Evaluate => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,"scene":self.scene,"actors":self.actors,"plans":self.plans}),
            ),
            Stage::Write => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,"scene":self.scene,"actors":self.actors,"selected_plan":self.selected}),
            ),
            Stage::Extract => {
                let mut input = json!({"context":context_view(context, self.stage_recall_start)?,"draft":self.draft});
                if let Some(feedback) = &self.repair_feedback {
                    input["repair_feedback"] = feedback.clone();
                }
                (String::new(), input)
            }
            Stage::RepairExtract => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,"draft":self.draft,
                    "extraction_error":self.extraction_error}),
            ),
            Stage::RepairState => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,
                    "candidate":self.candidate,"issues":self.review.as_ref().map(|r| &r.issues)}),
            ),
            Stage::Review | Stage::RepairReview => (
                String::new(),
                // Proposals guide drafting but are neither world facts nor
                // additional player authorization. Review the frozen result
                // independently against the original request and evidence.
                json!({"candidate":self.candidate,"context":context_view(context, self.stage_recall_start)?}),
            ),
            Stage::Revise => (
                String::new(),
                json!({"context":context_view(context, self.stage_recall_start)?,"draft":self.draft,"issues":self.review.as_ref().map(|r| &r.issues),"scene":self.scene,"actors":self.actors,"selected_plan":self.selected}),
            ),
            Stage::Done => unreachable!(),
        };
        let schema = stage_schema(self.stage, context);
        require(
            schema.to_string().len() <= MAX_STAGE_SCHEMA_BYTES,
            "stage_schema_capacity",
        )?;
        let material_prompt = if matches!(
            self.stage,
            Stage::Extract
                | Stage::RepairExtract
                | Stage::RepairState
                | Stage::Review
                | Stage::RepairReview
        ) {
            if context.mode == Mode::Ask {
                "仅依据读者材料审稿；coverage不代表完整历史。必要时可ReadRequest补查一次，保留后续调用。"
            } else {
                SOURCE_MATERIAL_PROMPT
            }
        } else {
            MATERIAL_PROMPT
        };
        let mut prompt = format!(
            "{}\n{}\n{}",
            COMMON_PROMPT,
            material_prompt,
            stage_prompt(self.stage)
        );
        reading::append(&mut prompt, context.mode, self.stage);
        if context.mode != Mode::Ask
            && !matches!(
                self.stage,
                Stage::Actor
                    | Stage::Extract
                    | Stage::RepairExtract
                    | Stage::RepairState
                    | Stage::Review
                    | Stage::RepairReview
            )
        {
            prompt.push_str(
                "\nmemories是索引；locator_quote/legacy quote只定位，实际证据见memory_evidence。",
            );
            prompt.push_str(SOURCE_MATERIAL_PROMPT);
            prompt.push_str("摘要仍可影响本场反应；coverage.unqueried未查原页，不证明没有往事。");
        }
        if matches!(self.stage, Stage::Review | Stage::RepairReview) {
            prompt.push('\n');
            prompt.push_str(REVIEW_EVIDENCE_PROMPT);
            prompt.push_str(REPAIR_SCOPE_PROMPT);
            prompt.push_str(MEMORY_REVIEW_PROMPT);
            prompt.push_str(include_str!("narrative_knowledge_review.txt"));
        }
        if matches!(
            self.stage,
            Stage::Extract | Stage::RepairExtract | Stage::RepairState
        ) {
            prompt.push('\n');
            prompt.push_str(MEMORY_EXTRACTION_PROMPT);
            prompt.push_str(include_str!("narrative_knowledge_extract.txt"));
        }
        if self.stage == Stage::Extract && self.repair_feedback.is_some() {
            prompt.push_str("repair_feedback是原被拒候选状态与具体审稿意见，不是正式事实。以当前draft为采用正文逐项核实并修正实际缺口；不得照抄旧状态、把旧事件迁入新正文或只删除合法交流来规避问题。");
        }
        if self.stage == Stage::RepairState
            || self.stage == Stage::Extract && self.repair_feedback.is_some()
        {
            prompt.push_str(REVIEW_EVIDENCE_PROMPT);
        }
        // Mirrored by Go preflight. Count the actual UTF-8 JSON, not characters or token estimates.
        // Producer caps below reserve enough room for the later review containing all evidence.
        let content_bytes = prompt.len()
            + schema.to_string().len()
            + input.to_string().len()
            + SCHEMA_TRANSPORT_GROWTH_BYTES;
        let context_bytes = serde_json::to_vec(context).unwrap().len();
        #[cfg(test)]
        if content_bytes > context_bytes + stage_overhead_bytes(context) {
            eprintln!(
                "stage={} aggregate={} reservation={} prompt={} schema={}",
                self.stage.name(),
                content_bytes - context_bytes,
                stage_overhead_bytes(context),
                prompt.len(),
                schema.to_string().len()
            );
        }
        require(
            content_bytes <= context_bytes + stage_overhead_bytes(context),
            "stage_content_capacity",
        )?;
        self.calls += 1;
        self.pending = true;
        Ok(StageRequest {
            stage: self.stage.name(),
            actor_id,
            prompt,
            schema,
            input,
        })
    }
    pub fn accept(&mut self, context: &Context, raw: &[u8]) -> Checked<PipelineStep> {
        require(self.pending, "pipeline_stage_unrequested")?;
        require(
            raw.len() <= crate::capacity::MAX_MODEL_OUTPUT_BYTES,
            "stage_output_capacity",
        )?;
        if let Ok(envelope) = serde_json::from_slice::<ResultEnvelope<ReadRequest>>(raw) {
            envelope.result.validate(context)?;
            if self.stage == Stage::Actor {
                require(
                    match &envelope.result.selector {
                        ReadSelector::Objects { objects, .. } => objects.iter().all(|o| {
                            o.object_type == ObjectType::Fact
                                && o.at_revision.is_none_or(|r| r == context.revision)
                        }),
                        ReadSelector::Enumerate { object_type, .. } => {
                            *object_type == ObjectType::Fact
                        }
                        _ => false,
                    },
                    "actor_read_scope",
                )?;
            }
            require(
                !self
                    .read_stages
                    .contains(&(self.stage, self.actor_index, self.repairs)),
                "stage_read_limit",
            )?;
            require(
                self.calls + self.remaining_required_calls() <= self.max_calls,
                "model_budget_exhausted",
            )?;
            require(
                context.recalls.len() < context.read_budget.max_reads as usize
                    && !context
                        .recalls
                        .iter()
                        .any(|r| r.request_id == envelope.result.request_id),
                "recall_budget_exhausted",
            )?;
            self.read_stages
                .insert((self.stage, self.actor_index, self.repairs));
            self.pending = false;
            return Ok(PipelineStep::Read(envelope.result));
        }
        match self.stage {
            Stage::Memory => {
                let scene: SceneFrame = result(raw)?;
                scene.validate(context, self.config.max_actors as usize)?;
                self.stage = if scene.actors.is_empty() {
                    Stage::Plan
                } else {
                    Stage::Actor
                };
                self.scene = Some(scene);
            }
            Stage::Actor => {
                let actor: ActorDecision = result(raw)?;
                let trigger = &self.scene.as_ref().unwrap().actors[self.actor_index];
                require(
                    actor.actor_id == trigger.actor_id
                        && nonempty(&actor.intent)
                        && nonempty(&actor.action)
                        && actor.conditions.len() <= 4
                        && actor.used_fact_ids.len() <= 16
                        && serde_json::to_vec(&actor).unwrap().len() <= MAX_INTERMEDIATE_BYTES,
                    "invalid_actor_decision",
                )?;
                // Go's actor projection includes all currently loaded known facts, not only
                // the few selected as scene triggers. Omitted authority is never guessed here.
                let evidence = recall::current_evidence(context)?;
                let allowed = evidence
                    .facts
                    .iter()
                    .filter(|f| f.known_by.contains(&trigger.actor_id))
                    .map(|f| f.id.as_str())
                    .collect();
                // Go validates against the exact authority-filtered material packet
                // it actually sent. Only genuinely omitted IDs are deferred.
                let all = state_ids(&evidence)?;
                deferred_references(
                    actor.used_fact_ids.iter().map(String::as_str),
                    &allowed,
                    &all,
                    !context.state_coverage.complete,
                )?;
                self.actors.push(actor);
                self.actor_index += 1;
                if self.actor_index == self.scene.as_ref().unwrap().actors.len() {
                    self.stage = Stage::Plan;
                }
            }
            Stage::Plan => {
                let plans: Plans = result(raw)?;
                plans.validate(context)?;
                self.plans = Some(plans);
                self.stage = Stage::Evaluate;
            }
            Stage::Evaluate => {
                let evaluations: Evaluations = result(raw)?;
                self.selected =
                    Some(select_plan(self.plans.as_ref().unwrap(), &evaluations, context)?.clone());
                self.stage = Stage::Write;
            }
            Stage::Write | Stage::Revise | Stage::Answer => {
                let draft: Draft = result(raw)?;
                draft.validate(context)?;
                if self.stage == Stage::Answer {
                    let candidate = draft.plain_candidate();
                    candidate.validate(context)?;
                    self.candidate = Some(candidate);
                    self.stage = Stage::Review;
                } else {
                    self.stage = Stage::Extract;
                }
                self.draft = Some(draft);
            }
            Stage::Extract | Stage::RepairExtract | Stage::RepairState => {
                let extracted: Extracted = match result(raw) {
                    Ok(extracted) => extracted,
                    Err(_) => return self.repair_extraction("invalid_extraction_envelope"),
                };
                require(
                    extracted.candidate.get().len() <= MAX_CANDIDATE_BYTES,
                    "candidate_budget_exceeded",
                )?;
                let candidate_raw =
                    match extraction::hydrate(extracted.candidate.get(), self.draft.as_ref()) {
                        Ok(raw) => raw,
                        Err(Invalid("invalid_candidate_shape")) => {
                            return self.repair_extraction("invalid_candidate_shape");
                        }
                        Err(error) => return Err(error),
                    };
                // Shape failures may be repaired once against the exact frozen draft.
                // Semantic failures (references, authority, revisions, knowledge) are
                // deliberately outside this path and fail closed without resampling.
                let value: Value = match serde_json::from_slice(&candidate_raw) {
                    Ok(value) => value,
                    Err(_) => return self.repair_extraction("invalid_candidate_json"),
                };
                if gameplay::shape(&value, "candidate").is_err()
                    || value.get("memory_delta").is_none()
                    || value.get("memory_changes").is_some()
                    || value.get("narrative_update").is_some()
                {
                    return self.repair_extraction("invalid_candidate_shape");
                }
                let candidate = Candidate::decode(&candidate_raw, context)?;
                require(
                    self.draft.as_ref().unwrap().matches(&candidate),
                    "extract_changed_draft",
                )?;
                require(
                    candidate.memory_delta.is_some()
                        && candidate.memory_changes.is_none()
                        && candidate.narrative_update.is_none(),
                    "memory_delta_required",
                )?;
                self.candidate = Some(candidate);
                self.stage = Stage::Review;
            }
            Stage::Review | Stage::RepairReview => {
                let review: Review = result(raw)?;
                let candidate = self.candidate.as_ref().unwrap();
                if let Err(error) = review.validate(candidate) {
                    if error.0 != "review_quote_mismatch"
                        || self.stage != Stage::Review
                        || context.mode == Mode::Ask
                        || self.repairs >= self.config.max_repairs
                    {
                        return Err(error);
                    }
                    require(self.calls < self.max_calls, "model_budget_exhausted")?;
                    self.repairs += 1;
                    self.review = None;
                    self.stage = Stage::RepairReview;
                    self.pending = false;
                    return Ok(PipelineStep::Continue);
                }
                if review.approved {
                    self.stage = Stage::Done;
                    self.pending = false;
                    return Ok(PipelineStep::Complete(candidate.clone()));
                }
                require(
                    context.mode != Mode::Ask && self.repairs < self.config.max_repairs,
                    "narrative_review_rejected",
                )?;
                let state_only = review.repair_scope == Some(RepairScope::CandidateState);
                require(
                    self.calls + if state_only { 2 } else { 3 } <= self.max_calls,
                    "model_budget_exhausted",
                )?;
                self.repairs += 1;
                if !state_only {
                    let mut state = serde_json::to_value(candidate).unwrap();
                    for field in extraction::FROZEN_FIELDS {
                        state.as_object_mut().unwrap().remove(field);
                    }
                    self.repair_feedback =
                        Some(json!({"candidate_state":state,"issues":review.issues}));
                }
                self.review = Some(review);
                self.stage = if state_only {
                    Stage::RepairState
                } else {
                    Stage::Revise
                };
            }
            Stage::Done => return Err(Invalid("pipeline_already_complete")),
        }
        self.pending = false;
        self.stage_recall_start = context.recalls.len();
        Ok(PipelineStep::Continue)
    }
    fn remaining_required_calls(&self) -> u32 {
        match self.stage {
            Stage::Memory => 6 + self.config.max_actors,
            Stage::Actor => {
                5 + (self.scene.as_ref().unwrap().actors.len() - self.actor_index) as u32
            }
            Stage::Plan => 5,
            Stage::Evaluate => 4,
            Stage::Write | Stage::Revise => 3,
            Stage::Extract | Stage::RepairExtract | Stage::RepairState | Stage::Answer => 2,
            Stage::Review | Stage::RepairReview => 1,
            Stage::Done => 0,
        }
    }
    fn repair_extraction(&mut self, reason: &'static str) -> Checked<PipelineStep> {
        require(
            self.stage == Stage::Extract && self.repairs < self.config.max_repairs,
            reason,
        )?;
        // A repair without room for its independent review cannot produce a page.
        require(self.calls + 2 <= self.max_calls, "model_budget_exhausted")?;
        self.repairs += 1;
        self.extraction_error = Some(reason);
        self.candidate = None;
        self.review = None;
        self.stage = Stage::RepairExtract;
        self.pending = false;
        Ok(PipelineStep::Continue)
    }
}
fn result<T: DeserializeOwned>(raw: &[u8]) -> Checked<T> {
    serde_json::from_slice::<ResultEnvelope<T>>(raw)
        .map(|e| e.result)
        .map_err(|_| Invalid("invalid_stage_result"))
}
fn context_view(context: &Context, recall_start: usize) -> Checked<Value> {
    // Recalls remain in operation evidence for validation/audit. A stage sees only
    // its own supplemental reads; Go independently compiles retained material.
    let mut stage_context = context.clone();
    stage_context.recalls = context.recalls.iter().skip(recall_start).cloned().collect();
    let mut current = recall::current_evidence(&stage_context)?;
    current.literary_memory = None;
    let state = if context.mode == Mode::Ask {
        known_information(&current)
    } else {
        current
    };
    let mut view = json!({"version":2,"experience_id":context.experience_id,"branch_id":context.branch_id,"revision":context.revision,
        "next_revision":context.revision+1,"mode":context.mode,"input":context.input,"state":state,"preferences":context.preferences,
        "reading_request":context.reading_request,"history":context.history,"history_complete":context.history_complete,"state_coverage":context.state_coverage});
    if context.mode != Mode::Ask {
        view["seed"] = json!(context.seed);
        view["gameplay_action"] = json!(context.gameplay_action);
    }
    // Older snapshots remain historical, never overwrite current known_by with them.
    view["historical_recalls"] = json!(context
        .recalls
        .iter()
        .skip(recall_start)
        .filter(|r| !r.pages.is_empty()
            || r.objects
                .iter()
                .any(|o| o.as_of_revision != context.revision))
        .collect::<Vec<_>>());
    view["read_budget"] = json!(context.read_budget);
    Ok(view)
}
impl SceneFrame {
    fn validate(&self, context: &Context, max_actors: usize) -> Checked<()> {
        require(
            nonempty(&self.objective)
                && self.objective.len() <= 1024
                && self.actors.len() <= max_actors
                && self.relevant_fact_ids.len() <= 32
                && serde_json::to_vec(self).unwrap().len() <= MAX_INTERMEDIATE_BYTES,
            "invalid_scene_frame",
        )?;
        let state = recall::current_evidence(context)?;
        if let Some(needs) = &self.context_needs {
            for (items, max, chars) in [
                (&needs.participant_ids, 8, 128),
                (&needs.relationship_targets, 8, 128),
                (&needs.topics, 8, 128),
                (&needs.open_questions, 8, 256),
                (&needs.fact_ids, 32, 128),
            ] {
                require(
                    items.len() <= max
                        && items
                            .iter()
                            .all(|s| nonempty(s) && s.chars().count() <= chars),
                    "invalid_context_needs",
                )?;
                unique(items.iter().map(String::as_str))?;
            }
            let all = state_ids(&state)?;
            let entities = state.entities.iter().map(|e| e.id.as_str()).collect();
            let facts = state.facts.iter().map(|f| f.id.as_str()).collect();
            deferred_references(
                needs.participant_ids.iter().map(String::as_str),
                &entities,
                &all,
                !context.state_coverage.complete,
            )?;
            deferred_references(
                needs.relationship_targets.iter().map(String::as_str),
                &entities,
                &all,
                !context.state_coverage.complete,
            )?;
            deferred_references(
                needs.fact_ids.iter().map(String::as_str),
                &facts,
                &all,
                !context.state_coverage.complete,
            )?;
        }
        let facts = state.facts.iter().map(|f| f.id.as_str()).collect();
        let all = state_ids(&state)?;
        deferred_references(
            self.relevant_fact_ids.iter().map(String::as_str),
            &facts,
            &all,
            !context.state_coverage.complete,
        )?;
        unique(self.actors.iter().map(|a| a.actor_id.as_str()))?;
        for actor in &self.actors {
            let entity = state.entities.iter().find(|e| e.id == actor.actor_id);
            require(
                entity
                    .map(|e| matches!(e.kind.as_str(), "character" | "person"))
                    .unwrap_or(
                        !context.state_coverage.complete && !all.contains(actor.actor_id.as_str()),
                    )
                    && nonempty(&actor.trigger)
                    && actor.trigger.len() <= 1024
                    && actor.fact_ids.len() <= 16,
                "invalid_actor_trigger",
            )?;
            let known = state
                .facts
                .iter()
                .filter(|f| f.known_by.contains(&actor.actor_id))
                .map(|f| f.id.as_str())
                .collect();
            deferred_references(
                actor.fact_ids.iter().map(String::as_str),
                &known,
                &all,
                !context.state_coverage.complete,
            )?;
            // Merely naming an actor in a private action does not make that action observable.
            let known_trigger = state
                .facts
                .iter()
                .any(|f| actor.fact_ids.contains(&f.id) && f.text.contains(&actor.trigger));
            let addressed = context.mode == Mode::Act
                && entity.is_some_and(|e| {
                    context.input == format!("我对{}说：“{}”", e.name, actor.trigger)
                });
            // Go validates the exact trigger against the pinned authority and
            // player input before sending an actor packet, including omitted sources.
            let omitted_trigger = !context.state_coverage.complete
                && (entity.is_none() || actor.fact_ids.iter().any(|id| !all.contains(id.as_str())));
            require(
                known_trigger || addressed || omitted_trigger,
                "actor_trigger_not_observed",
            )?;
        }
        Ok(())
    }
}
impl Plans {
    fn validate(&self, context: &Context) -> Checked<()> {
        require(
            (2..=3).contains(&self.candidates.len()),
            "invalid_plan_count",
        )?;
        unique(self.candidates.iter().map(|p| p.id.as_str()))?;
        let state = recall::current_evidence(context)?;
        let facts = state.facts.iter().map(|f| f.id.as_str()).collect();
        let threads = state.threads.iter().map(|t| t.id.as_str()).collect();
        let all = state_ids(&state)?;
        for plan in &self.candidates {
            require(
                nonempty(&plan.purpose)
                    && (1..=3).contains(&plan.beats.len())
                    && plan.beats.iter().all(|b| nonempty(b))
                    && plan.causes.len() <= 4
                    && plan.costs.len() <= 4
                    && plan.consequences.len() <= 4
                    && plan.fact_ids.len() <= 32
                    && plan.thread_ids.len() <= 16
                    && serde_json::to_vec(plan).unwrap().len() <= MAX_INTERMEDIATE_BYTES,
                "invalid_plot_candidate",
            )?;
            deferred_references(
                plan.fact_ids.iter().map(String::as_str),
                &facts,
                &all,
                !context.state_coverage.complete,
            )?;
            deferred_references(
                plan.thread_ids.iter().map(String::as_str),
                &threads,
                &all,
                !context.state_coverage.complete,
            )?;
        }
        Ok(())
    }
}
pub fn select_plan<'a>(
    plans: &'a Plans,
    evaluations: &Evaluations,
    context: &Context,
) -> Checked<&'a PlotCandidate> {
    plans.validate(context)?;
    require(
        evaluations.evaluations.len() == plans.candidates.len(),
        "evaluation_coverage",
    )?;
    unique(
        evaluations
            .evaluations
            .iter()
            .map(|e| e.candidate_id.as_str()),
    )?;
    let state = recall::current_evidence(context)?;
    let facts = state.facts.iter().map(|f| f.id.as_str()).collect();
    let all = state_ids(&state)?;
    let mut selected = None;
    let mut best = 0;
    for plan in &plans.candidates {
        let e = evaluations
            .evaluations
            .iter()
            .find(|e| e.candidate_id == plan.id)
            .ok_or(Invalid("evaluation_coverage"))?;
        require(
            [
                e.continuity,
                e.agency,
                e.causality,
                e.consequence,
                e.pacing,
                e.interest,
            ]
            .iter()
            .all(|n| *n <= 5)
                && e.blocking_issues.len() <= 8
                && e.evidence_fact_ids.len() <= 32,
            "invalid_evaluation",
        )?;
        deferred_references(
            e.evidence_fact_ids.iter().map(String::as_str),
            &facts,
            &all,
            !context.state_coverage.complete,
        )?;
        if !e.blocking_issues.is_empty() {
            continue;
        }
        let score = 3 * e.continuity
            + 3 * e.agency
            + 3 * e.causality
            + 2 * e.consequence
            + e.pacing
            + e.interest;
        if selected.is_none() || score > best {
            selected = Some(plan);
            best = score;
        }
    }
    selected.ok_or(Invalid("no_eligible_plot"))
}
impl Draft {
    fn validate(&self, context: &Context) -> Checked<()> {
        let normalized = self.passage.replace("\r\n", "\n");
        let paragraphs = normalized
            .split("\n\n")
            .filter(|p| !p.trim().is_empty())
            .count();
        // Reading can deliver the requested narrative unit with natural
        // paragraphs. This is a safety ceiling, never a target to fill.
        let max_paragraphs = if context.mode == Mode::Read { 24 } else { 3 };
        require(
            nonempty(&self.title)
                && self.title.len() <= 256
                && self.story_time.len() <= 512
                && nonempty(&self.passage)
                && self.passage.len() <= 8192
                && (1..=max_paragraphs).contains(&paragraphs)
                && self.suggestions.len() <= 4
                && self
                    .suggestions
                    .iter()
                    .all(|s| nonempty(s) && s.len() <= 512),
            "invalid_scene_beat",
        )?;
        require(
            context.mode != Mode::Ask || self.story_time == context.state.story_time,
            "ask_changes_world",
        )
    }
    fn matches(&self, c: &Candidate) -> bool {
        self.title == c.title
            && self.passage == c.passage
            && self.story_time == c.story_time
            && self.outcome == c.outcome
            && self.suggestions == c.suggestions
    }
    fn plain_candidate(&self) -> Candidate {
        Candidate {
            title: self.title.clone(),
            passage: self.passage.clone(),
            story_time: self.story_time.clone(),
            outcome: self.outcome,
            suggestions: self.suggestions.clone(),
            new_facts: vec![],
            new_entities: vec![],
            new_threads: vec![],
            reveal_fact_ids: vec![],
            reveal_entity_ids: vec![],
            reveal_thread_ids: vec![],
            resolve_thread_ids: vec![],
            knowledge_changes: vec![],
            gameplay_update: None,
            narrative_update: None,
            memory_changes: None,
            memory_delta: None,
        }
    }
}
impl Review {
    pub fn validate(&self, candidate: &Candidate) -> Checked<()> {
        require(
            self.repair_scope
                .map_or(true, |scope| (scope == RepairScope::None) == self.approved),
            "invalid_repair_scope",
        )?;
        require(
            self.issues.len() <= 12
                && self
                    .issues
                    .iter()
                    .all(|i| nonempty(&i.code) && nonempty(&i.detail))
                && serde_json::to_vec(&self.issues).unwrap().len() <= MAX_INTERMEDIATE_BYTES,
            "invalid_semantic_review",
        )?;
        // The new form is structural only here. Go owns the actual-request
        // registry and checks membership, candidate origin and required pages.
        for support in &self.memory_supports {
            match support {
                MemorySupport::Sources(support) => {
                    require(
                        candidate.memory_delta.is_some() && !support.source_ids.is_empty(),
                        "review_memory_support_invalid",
                    )?;
                    unique(support.source_ids.iter().map(String::as_str))?;
                }
                MemorySupport::Legacy(_) => {
                    require(
                        candidate.memory_delta.is_none(),
                        "review_memory_support_invalid",
                    )?;
                }
            }
        }
        if !self.approved {
            return require(!self.issues.is_empty(), "review_rejection_without_issue");
        }
        let edges: HashSet<_> = candidate
            .knowledge_changes
            .iter()
            .map(|k| (&k.subject_id, &k.fact_id))
            .chain(
                candidate
                    .new_facts
                    .iter()
                    .flat_map(|f| f.known_by.iter().map(move |s| (s, &f.id))),
            )
            .collect();
        require(
            self.issues.is_empty()
                && self.supports.len() == candidate.new_facts.len()
                && self.knowledge_supports.len() == edges.len(),
            "review_evidence_missing",
        )?;
        unique(self.supports.iter().map(|s| s.fact_id.as_str()))?;
        for s in &self.supports {
            require(
                candidate.new_facts.iter().any(|f| f.id == s.fact_id) && nonempty(&s.quote),
                "review_fact_support_invalid",
            )?;
        }
        let mut seen = HashSet::new();
        for s in &self.knowledge_supports {
            require(
                seen.insert((&s.subject_id, &s.fact_id))
                    && edges.contains(&(&s.subject_id, &s.fact_id))
                    && nonempty(&s.quote),
                "review_knowledge_support_invalid",
            )?;
        }
        let reveals: HashSet<_> = candidate
            .reveal_fact_ids
            .iter()
            .map(|id| (ObjectType::Fact, id))
            .chain(
                candidate
                    .reveal_entity_ids
                    .iter()
                    .map(|id| (ObjectType::Entity, id)),
            )
            .chain(
                candidate
                    .reveal_thread_ids
                    .iter()
                    .map(|id| (ObjectType::Thread, id)),
            )
            .collect();
        require(
            self.reveal_supports.len() == reveals.len(),
            "review_reveal_evidence_missing",
        )?;
        let mut seen = HashSet::new();
        for s in &self.reveal_supports {
            require(
                seen.insert((s.object_type, &s.id))
                    && reveals.contains(&(s.object_type, &s.id))
                    && nonempty(&s.quote),
                "review_reveal_support_invalid",
            )?;
        }
        let memory_ids: Vec<_> = match &candidate.memory_delta {
            Some(delta) => delta
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect(),
            None => candidate
                .memory_changes
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .map(|entry| entry.id.as_str())
                .collect(),
        };
        require(
            self.memory_supports.len() == memory_ids.len(),
            "review_memory_evidence_missing",
        )?;
        unique(self.memory_supports.iter().map(MemorySupport::memory_id))?;
        for support in &self.memory_supports {
            require(
                memory_ids.contains(&support.memory_id()),
                "review_memory_support_invalid",
            )?;
            if let MemorySupport::Legacy(support) = support {
                require(
                    candidate
                        .memory_changes
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
                        .any(|m| m.id == support.memory_id && m.quote == support.quote),
                    "review_memory_support_invalid",
                )?;
            }
        }
        // Check every ID, duplicate, coverage edge and nonempty quote first.
        // A mismatch cannot hide a separate reference failure behind a retry.
        require(
            self.supports
                .iter()
                .map(|s| &s.quote)
                .chain(self.knowledge_supports.iter().map(|s| &s.quote))
                .chain(self.reveal_supports.iter().map(|s| &s.quote))
                .chain(
                    self.memory_supports
                        .iter()
                        .filter_map(MemorySupport::legacy_quote),
                )
                .all(|quote| candidate.passage.contains(quote)),
            "review_quote_mismatch",
        )
    }
}
fn object(properties: Value) -> Value {
    let required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
    json!({"type":"object","additionalProperties":false,"properties":properties,"required":required})
}
fn string() -> Value {
    json!({"type":"string"})
}
fn list(item: Value, max: usize) -> Value {
    json!({"type":"array","items":item,"maxItems":max})
}
fn strings(max: usize) -> Value {
    list(string(), max)
}
fn draft_passage_schema(mode: Mode) -> Value {
    // Producer format, deliberately narrower than Draft::validate: nonblank
    // lines, single LF/CRLF inside a paragraph, exactly two between paragraphs.
    // Line indentation remains legal. No content is rewritten or normalized.
    // Explicit Unicode characters keep ECMAScript and Go RE2 class semantics
    // aligned; regex \s and \u escapes are not portable between those engines.
    const SPACES: &str = concat!(
        "\u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}",
        "\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{202f}",
        "\u{205f}\u{3000}\u{feff}"
    );
    let horizontal = format!(r"[\x09\x0b\x0c\x20{SPACES}]");
    let token = format!("[^\\x09-\\x0d\\x20\\x85{SPACES}\u{2028}\u{2029}]+");
    let line = format!("{horizontal}*{token}(?:{horizontal}+{token})*{horizontal}*");
    let paragraph = format!(r"{line}(?:\r?\n{line})*");
    let separators = if mode == Mode::Read { 23 } else { 2 };
    let pattern = format!(r"^{paragraph}(?:\r?\n\r?\n{paragraph}){{0,{separators}}}$");
    // This pattern does not replace UTF-8 byte, scope, or semantic validation.
    json!({"type":"string","pattern":pattern})
}
fn stage_schema(stage: Stage, context: &Context) -> Value {
    let schema = match stage {
        Stage::Memory => object(
            json!({"actors":list(object(json!({"actor_id":string(),"trigger":string(),"fact_ids":strings(16)})),2),"relevant_fact_ids":strings(32),"objective":string(),
                "context_needs":{"$ref":"#/$defs/context_needs"}}),
        ),
        Stage::Actor => object(
            json!({"actor_id":string(),"intent":string(),"action":string(),"speech":string(),"conditions":strings(4),"used_fact_ids":strings(16)}),
        ),
        Stage::Plan => object(
            json!({"candidates":list(object(json!({"id":string(),"purpose":string(),"beats":strings(3),"causes":strings(4),"costs":strings(4),"consequences":strings(4),"thread_ids":strings(16),"fact_ids":strings(32)})),3)}),
        ),
        Stage::Evaluate => {
            let score = json!({"type":"integer","minimum":0,"maximum":5});
            object(
                json!({"evaluations":list(object(json!({"candidate_id":string(),"continuity":score,"agency":score,"causality":score,"consequence":score,"pacing":score,"interest":score,"blocking_issues":strings(8),"evidence_fact_ids":strings(32)})),3)}),
            )
        }
        Stage::Write | Stage::Revise | Stage::Answer => object(
            json!({"title":string(),"passage":draft_passage_schema(context.mode),"story_time":string(),"outcome":{"type":"string","enum":["continues","awaits_player","ending"]},"suggestions":strings(4)}),
        ),
        Stage::Extract | Stage::RepairExtract | Stage::RepairState => {
            object(json!({"candidate":{"$ref":"#/$defs/candidate"}}))
        }
        Stage::Review | Stage::RepairReview => object(
            json!({"approved":{"type":"boolean"},"repair_scope":{"type":"string","enum":["none","candidate_state","draft","mixed","undetermined"]},"issues":list(object(json!({"code":string(),"detail":string()})),12),"supports":list(object(json!({"fact_id":string(),"quote":string()})),64),"knowledge_supports":list(object(json!({"subject_id":string(),"fact_id":string(),"quote":string()})),128),"reveal_supports":list(object(json!({"type":{"type":"string","enum":["fact","entity","thread"]},"id":string(),"quote":string()})),128),"memory_supports":list(object(json!({"memory_id":string(),"source_ids":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","minLength":1}}})),12)}),
        ),
        Stage::Done => unreachable!(),
    };
    let result = json!({"anyOf":[schema,{"$ref":"#/$defs/read_request"}]});
    let mut root = with_contract_definitions(object(json!({"result":result})));
    if matches!(
        stage,
        Stage::Extract | Stage::RepairExtract | Stage::RepairState
    ) {
        for key in extraction::FROZEN_FIELDS {
            root["$defs"]["candidate"]["properties"]
                .as_object_mut()
                .unwrap()
                .remove(key);
        }
        root["$defs"]["candidate"]["required"]
            .as_array_mut()
            .unwrap()
            .retain(|value| !extraction::FROZEN_FIELDS.contains(&value.as_str().unwrap_or("")));
        root["$defs"]["candidate"]["required"]
            .as_array_mut()
            .unwrap()
            .push(json!("memory_delta"));
        // Only the canonical decoder remains backward compatible. Live
        // extraction must use the explicitly versioned interpretation delta.
        root["$defs"]["candidate"]["properties"]
            .as_object_mut()
            .unwrap()
            .remove("narrative_update");
        root["$defs"]["candidate"]["properties"]
            .as_object_mut()
            .unwrap()
            .remove("memory_changes");
        if context.state.gameplay.is_none() && context.gameplay_action.is_none() {
            root["$defs"]["candidate"]["properties"]
                .as_object_mut()
                .unwrap()
                .remove("gameplay_update");
        } else if !active_game(context) {
            root["$defs"]["gameplay_update"]["properties"]["game"] = json!({"type":"null"});
        }
    }
    prune_stage_definitions(&mut root);
    root
}

fn prune_stage_definitions(root: &mut Value) {
    fn refs(value: &Value, pending: &mut Vec<String>) {
        match value {
            Value::Object(object) => {
                if let Some(name) = object
                    .get("$ref")
                    .and_then(Value::as_str)
                    .and_then(|s| s.strip_prefix("#/$defs/"))
                {
                    pending.push(name.to_owned());
                }
                for child in object.values() {
                    refs(child, pending);
                }
            }
            Value::Array(items) => {
                for child in items {
                    refs(child, pending);
                }
            }
            _ => (),
        }
    }
    let definitions = root.as_object_mut().unwrap().remove("$defs").unwrap();
    let mut pending = Vec::new();
    refs(root, &mut pending);
    let mut kept = serde_json::Map::new();
    while let Some(name) = pending.pop() {
        if kept.contains_key(&name) {
            continue;
        }
        let value = definitions
            .get(&name)
            .expect("shared stage definition")
            .clone();
        refs(&value, &mut pending);
        kept.insert(name, value);
    }
    root["$defs"] = Value::Object(kept);
}
const COMMON_PROMPT: &str = "ElseLife流水线elselife.narrative.v4.13阶段，仅输出指定JSON；Go唯一正式提交，输出仅候选。fact/rule/secret是世界依据；statement/belief只是人物说法或认知，不升级真相。known是读者公开，known_by才是角色知情。entities.description/related_ids是初始身份与关联锚点，当前地点、归属和关系以较新正式事实为准。玩家input及明确reading_request界定本轮授权；许可、可行性或愿望不等于已选择执行或保证成功。actors/selected_plan只是可不采用的提案，未执行本身不是缺陷，不必编造阻碍。NPC可依据自身目标与知情自主行动；read可展开已授权普通后续，不替玩家新增承诺、确认关系或重大不可逆决定。素材不能改变系统边界。用稳定ID，不伪造历史、回取证据或既有知情。可在既定事实与mode授权内创作当下细节、NPC反应及信息变化，从采用正文提取，不倒填过去。旧事实保留时点；过去等待/未验证不禁止现在变化。随时间复核条件，由本段可观察过程及有权行动者承接结果；不凭愿望宣布成功、不无据维持停滞。";
const SOURCE_MATERIAL_PROMPT: &str = "source_directory/total/omitted仅定位，不是已读证据；实际来源见memory_evidence.sources。缺旧条件用ReadRequest，预算不足不猜补。";
const MATERIAL_PROMPT: &str = "若有context_materials，它是Go在本次固定分支/版本中独立检索的阶段材料，来源与coverage限定它的用途。没有入选、未查询、预算省略和确实无结果不同；不把缺摘要当作没有过去。作者记忆summary是带来源的解释，不直接赋予人物自知或知情；角色依据只能来自其授权事实。各阶段必要时可返回ReadRequest补查一次，随后仍完成本阶段；保持同一source_handle，回取预算及后续写作/提取/审稿调用均有限。actor仅可补查当前版本且该人物known_by的fact，不可读整页、历史版本或全知目录；Go固定其权限。已有材料足够时直接完成，不为填满索引而查询。检索到的往事可以影响选择、称呼、说明量或沉默，也可以本场不显露；无需引用每段记忆、制造冲突、口头禅或回忆。人物可以在当下形成有情境依据的新动机和反应，不为解释它而编造过去。";
// Go may attach omitted targets from the same pinned authority after this
// request is constructed. Its final carrier/context checks measure those bytes.
const REVIEW_EVIDENCE_PROMPT: &str = "review_evidence是Go按固定分支/base_revision补齐的knowledge_targets旧记录全文及subjects身份；不改state_coverage、不授知情、不构成正文告知或观察。known_by仅本段前知情；description只初次身份锚点，非当前状态。";
const REPAIR_SCOPE_PROMPT: &str = "repair_scope：批准none；拒绝仅状态错且title/passage/story_time/outcome/suggestions均不变为candidate_state，仅草稿错draft，两者mixed，不明undetermined。不猜错误码；issues列字段/ID及缺口，不扩授权。";
const MEMORY_EXTRACTION_PROMPT: &str = "memory_delta={version:2,entries:[解释条目]}，无变化entries=[]，不输出memory_changes或narrative_update。summary由当前采用正文及实际旧依据支持，保留条件/否定/时间/认知归属；不以旧摘要、计划或未发生事件补证。可省locator_quote；若有，只作当前正文精确原句定位，不要求覆盖摘要。稳定ID的kind/subject_ids/target_ids不扩大或换人；新增参与方/目标用新ID。来源版本/hash由Go填写，目录不授人物知情。";
const MEMORY_REVIEW_PROMPT: &str = "逐条审memory_delta.entries摘要的事实、条件/否定/时间/归属及反例。memory_supports{memory_id,source_ids}选择本次目录，非空且唯一，含当前candidate来源；累计含义另选实际完整正式页/事实。旧摘要不能作证，短locator不是错因，有效ID/hash不证语义。required_pages未loaded须补读、不能批准；最新页只是最低锚点，更早条件仍需依据。";
fn stage_prompt(stage: Stage) -> &'static str {
    match stage {
    Stage::Memory => "阶段memory：依据阶段材料、事实/历史确定本次叙述objective、relevant_fact_ids及最多2个角色actors，同时给context_needs(participant_ids,relationship_targets,topics,open_questions,fact_ids)：participant_ids与relationship_targets只填既有entities.id，不填姓名或关系描述；关系描述放topics，fact_ids只填既有facts.id，open_questions写待核实问题。这些只是检索需求，不声明在场或知情，整个result<=2048 UTF8字节。begin/act按短场景组织；read按统一阅读篇幅策略组织完整叙述单位，不强压成三段。只为确需独立响应的人物选择actors，允许为空；依明确叙事身份和本次input识别玩家主体，不猜身份、不替其产生未授权自主决定；明确read委托内的普通行动仍可叙述。时间跨度或收束请求先核对原始目标、既有能力资源和当前阻碍；旧笔记的等待目标须按当前时间重新判断，不能把临时状态升级为永久约束。若这些依据只剩笔记里的fact_id/摘要且原事实被省略，先用同操作ReadRequest回取所需原文，再形成目标。actor_id必须为已存在character/person，fact_ids只引用其known_by事实；trigger逐字取自这些事实，或严格格式『我对<角色名>说：“<trigger>”』的act输入引号内原句。言语仍是conditional attempt，不当作已听到。不能投送秘密行动、作者全知或其他角色认知。缺因果依据可返回ReadRequest(request_id,source_handle,selector,max_reply_bytes)，按objects/names精确名字/pages/enumerate字面terms回取，不是语义检索；预算耗尽不猜补。",
    Stage::Actor => "阶段actor：整个result<=2048 UTF8字节；只依据本角色facts/profile/trigger及conditional_attempt，返回actor_id,intent,action,speech,conditions,used_fact_ids。先考虑本角色此刻在乎什么、面对谁、彼此既有经历与当前关系，再形成行动意图。自主表达目标顾虑，可拒绝、误解、提出条件或替代方案，不保证玩家成功。speech是可供writer改写的草稿，不是必须逐字照读的台词；让熟悉程度、遮掩、体面和当下情绪影响表达，不把每条内部核验说出口，不强制独特口头禅；资料没有支持时不补造生平。used_fact_ids来自投影fact_ids；条件性输入只能条件响应。不得推断未给出的私密事实、其他角色决定或玩家计划。",
    Stage::Plan => "阶段plan：输出2–3个有实质差异的candidates，每项id,purpose,beats(1–3),causes,costs,consequences,thread_ids,fact_ids，每项<=2048 UTF8字节。引用既有事实/伏笔，记录真实存在的资源/关系/时间机会代价，costs允许为空；低难度事项的顺利完成合法，不为凑代价增加阻碍，也不无据满足愿望。沿用仍合理的narrative.arcs，新输入可使其失效；未来不是事实。尊重actor自主性和知识边界。read让环境、NPC目标或既有后果产生有据变化；已授权工作的常规后续、NPC自己的行动和条件随时间变化可以在本段展开，重大保留决定仍交玩家。若局面已可推进，至少比较推进结果与其他实质不同方案，不能所有候选都只是换细节维持同一等待。收束须回应原目标：完成、明确失败或有具体依据的未决均可，不以旁支家务结束冒充原目标得到结果。",
    Stage::Evaluate => "阶段evaluate：独立逐候选返回candidate_id和0..5分continuity,agency,causality,consequence,pacing,interest，以及blocking_issues,evidence_fact_ids。越权知情、违反事实、替玩家重大决定、无据回收伏笔是阻塞，玩家不成功不是阻塞。合法的新创作不必提前存在于facts，不能仅因此判阻塞；检查它是否与既定事实相容、遵守角色信息边界与mode授权。区分改写过去与现在发生新变化；旧等待条件已变化却无依据继续停滞，不能获得高因果/后果/节奏分。优先带来具体变化或新理解、而非重复前页问答的方案；安静过渡可以用于反应、关系或节奏，但须有作用，不强造危机或保证玩家成功。收束是否兑现此前场景目标须看实际结果，不能只看outcome标签或优美落笔。代码按3连续性+3自主性+3因果+2后果+节奏+吸引力稳定选择，平分沿原顺序。",
    Stage::Write => "阶段write：在原input与明确reading_request授权内参考selected_plan写正文，passage<=8192 UTF8字节；输出title,passage,story_time,outcome,suggestions。begin/act仍1–3段短场景；read按统一阅读篇幅策略自然完整展开，最多24段只是安全上限而非填充目标。计划的beats是有限因果变化，不规定文字段落数。遵守既定叙述声音/视角。人物对白从各自目的、彼此关系、共同经历和眼前情境出发；同一个人面对不同对象可以有不同说明量、称呼、回避与停顿。actor.speech是草稿，可重写为自然应答；意图与知识条件不应逐条变成核对清单，内部约束只在听者确实缺信息时通过交流呈现。允许普通相似回答，不强造每人专属口头禅、辞藻或轮番回忆；旧经历在本场没有作用时不露出。动作/空间/感官承载情绪，避免重复解释、套式总结。高潮和缓冲交替，不硬造危机。explicit偏好优先，reading_request只约束本次；不从虚构行为推断现实人格。suggestions只是草稿未执行；关键抉择可awaits_player，不每段停问。",
    Stage::Extract => "阶段extract：输出{result:{candidate:状态变化对象}}，candidate必须是对象，不是JSON字符串。仅输出schema状态字段，空变更[]，不输出五个草稿字段。按采用正文提取，不将计划/假设/belief升级；source_revision=next_revision。新entity.description只写稳定身份特征，位置、持有与关系变化写有版本facts及可选reader，不改既有entity。memory_delta只写本页变化，最多12条。一场任务、一次沉默或应激先记为有条件的经历，不概括永久人格；保留时间、条件、否定、不确定性、关系方向与反例。未采用计划、未来推测不写为已发生事件或承诺；关系解释写清归属，不能以摘要授予知情。完整候选<=24576字节。secret新增known=false；statement/belief需人物subject_id。公开既有隐藏对象用reveal IDs，不新建冒充；解线索用resolve。reader及gameplay_update只能同一事实和正文支持，未知位置数量不填；quote须正文连续原句，clock.label=story_time。gameplay_action的dynamic/game changes是权威已定结果，仅叙述反应，不另加facts/entities/threads/knowledge或数值；journey按授权路径/费用/耗时构造transit与clock.elapsed，不超预算，不把报价当执行。",
    Stage::RepairState => "阶段repair_state：被拒candidate及issues不是正式事实或必然正确的指令。核对原请求、世界依据与candidate.passage，只修实际成立的状态问题；不改五个冻结草稿字段、不补写剧情制造依据。复合事实过授时按实际来源拆窄或校正知情边，保留合法交流，不机械清空变更。记忆只据实际正文与必要旧依据修解释，不因短locator而删有据含义；仍输出v2 memory_delta。输出{result:{candidate:完整状态变化对象}}，非局部patch；不输出title/passage/story_time/outcome/suggestions，程序原字补回。保留未受问题影响且仍有依据的变更，使用稳定ID及next_revision，遵守原合同及24576字节候选上限。与其他修复共用唯一预算，随后独立review；无法据实修正不得伪造成功。",
    Stage::RepairExtract => "阶段repair_extract：上次提取不满足JSON结构合同，extraction_error是机器校验类别。这是与语义修订及审稿共用的唯一一次修复；只重新提取同一冻结draft的状态变化，不为了成功改事件或补事实。输出{result:{candidate:状态变化对象}}，candidate不是JSON字符串，仅按schema字段构造；不要输出title/passage/story_time/outcome/suggestions，程序逐字补入冻结draft；空变更[]。memory_delta={version:2,entries:[本页局部解释]}，最多12条，无变化entries=[]；不整本替换notebook，不把一次反应升级为永久人格，不写未执行计划，候选<=24576字节。只提取实际正文支持的事实、观察和知情；既有隐藏对象用reveal IDs。修复后仍须独立review，无法合法表达则不伪造成功。",
    Stage::Review => "阶段review：独立核对candidate正文和状态与原请求、世界依据：玩家授权、事实/认知、角色知情、因果时序、代价、伏笔转折、风格和阅读要求。actor/plan是可不采用的提案，不以未执行为缺陷或扩张授权。记忆不把临时任务写成人格、无据抹去旧关系或将作者材料当人物自知；审对白立场与自然性，不强制每场回忆或人人刻意不同。无问题才approved=true且issues=[]；否则false并具体说明。每条new_facts给supports{fact_id,quote}；knowledge_changes与new_facts.known_by边并集逐一给knowledge_supports{subject_id,fact_id,quote}；每个reveal ID给reveal_supports{type,id,quote}；memory_delta逐条给来源支持，不复写locator。各项完整、无重复，无变更[]。事实/知情/公开支持quote须包含完整必要语义；事实/知情/公开quote解码后须为passage精确连续子串，实际换行不改字面反斜杠n。issues总JSON<=2048 UTF8字节。ask只解释读者已知且不改时间/状态。",
    Stage::RepairReview => "阶段repair_review：上次引用失配，未提交批准。对同一冻结candidate重新独立审稿，与其他修复共用唯一预算；不改任何字段、不重写正文、不为通过改判。按原请求及世界依据核对授权、事实/认知、角色知情、时序因果、记忆和阅读要求；未执行提案不构成义务，真正无来源的知情仍须拒绝。记忆不升级临时反应为人格、无据抹去旧关系或将作者材料当人物自知。无问题才approved=true且issues=[]，否则false及具体issues。每条new_facts给supports{fact_id,quote}，knowledge_changes与new_facts.known_by边并集给knowledge_supports{subject_id,fact_id,quote}，每个reveal ID给reveal_supports{type,id,quote}，memory_delta逐条重新选择本轮来源，不复用前审注册表；完整、无重复，无变更[]。事实/知情/公开quote须含必要语义，解码后是passage精确连续子串，不将实际换行改为字面反斜杠n或再复制编码表示。issues总JSON<=2048 UTF8字节；失败即停止。",
    Stage::Revise => "阶段revise：先核对issues与原input、明确read委托及世界依据，只修实际成立的问题；issues不扩张玩家授权，要求执行未选actor.action或越权改变玩家决定的修正不得跟随。仍修复真正的无来源知情与事实缺口，不因某条issue无据而忽略其它成立的问题。保持已授权事件、物品归属、人物立场、不确定程度，除非有据issue指出越权/无据。不为玩家成功换剧情重试。沿用write的范围：begin/act仍1–3段；read按统一阅读篇幅策略保留完整阅读片段，最多24段，上限不作填充目标。passage<=8192 UTF8字节，返回write相同字段，再extract/review。这是唯一一次修订。",
    Stage::Answer => "阶段answer：ask跳出故事，仅解释给定读者投影。未知说尚未得知，不推测秘密/内心/笔记，不变对白、不推进时间；story_time原字保留state.story_time。输出title,passage(1–3段),story_time,outcome,suggestions。缺读者已知旧页可ReadRequest，不扩大audience。",
    Stage::Done => unreachable!(),
}
}

#[cfg(test)]
mod capacity_tests {
    use super::*;

    #[test]
    fn actual_draft_stage_schemas_keep_mode_specific_producer_format_and_wire_shape() {
        // Independent Node/Go probes exercise this recorded pattern's grammar.
        // This test checks the actual stage builder's mode wiring and carrier,
        // not model compliance or the meaning of a generated story.
        let patterns: Value = serde_json::from_slice(include_bytes!(
            "../tests/fixtures/draft-passage-patterns.json"
        ))
        .unwrap();
        for mode in [Mode::Begin, Mode::Act, Mode::Read, Mode::Ask] {
            let mut context = carrier_context("ordinary");
            context.mode = mode;
            let limit = if mode == Mode::Read { "24" } else { "3" };
            for stage in [Stage::Write, Stage::Revise, Stage::Answer] {
                let schema = stage_schema(stage, &context);
                let draft = &schema["properties"]["result"]["anyOf"][0];
                assert_eq!(
                    draft["properties"]["passage"],
                    json!({"type":"string","pattern":patterns["patterns"][limit]})
                );
                let properties = draft["properties"].as_object().unwrap();
                let mut keys: Vec<_> = properties.keys().map(String::as_str).collect();
                keys.sort();
                assert_eq!(
                    keys,
                    ["outcome", "passage", "story_time", "suggestions", "title"]
                );
                assert_eq!(
                    schema["properties"]["result"]["anyOf"][1]["$ref"],
                    "#/$defs/read_request"
                );
                assert!(schema.to_string().len() <= MAX_STAGE_SCHEMA_BYTES);
            }
        }
    }

    #[test]
    fn state_repair_measures_full_feedback_and_fails_closed_at_existing_budget() {
        // Valid candidate structures. These fixed cases prove byte accounting,
        // not that any of the invented facts are supported by the prose.
        for kind in ["ordinary", "experience", "game"] {
            for maximal in [false, true] {
                let c = carrier_context(kind);
                let draft = Draft {
                    title: "t".into(),
                    passage: "body".into(),
                    story_time: c.state.story_time.clone(),
                    outcome: Outcome::Continues,
                    suggestions: vec![],
                };
                let mut candidate = draft.plain_candidate();
                candidate.memory_delta = Some(MemoryDelta {
                    version: 2,
                    entries: vec![],
                });
                for index in 0..if maximal { 10 } else { 1 } {
                    candidate.new_facts.push(Fact {
                        id: format!("f-{index}"),
                        kind: FactKind::Fact,
                        text: "x".repeat(if maximal { 2200 } else { 100 }),
                        subject_id: String::new(),
                        known: true,
                        known_by: vec![],
                        source_revision: c.revision + 1,
                        reader: None,
                    });
                }
                if maximal {
                    let padding =
                        MAX_CANDIDATE_BYTES - serde_json::to_vec(&candidate).unwrap().len();
                    candidate.new_facts[0].text.push_str(&"x".repeat(padding));
                }
                // The active game has separate world mutation rules; use its
                // schema to measure carriers, never claim gameplay acceptance.
                if kind != "game" {
                    Candidate::decode(&serde_json::to_vec(&candidate).unwrap(), &c).unwrap();
                }
                for stage in [Stage::RepairState, Stage::Extract] {
                    let mut p = Pipeline::new(&c, 12).unwrap();
                    p.stage = stage;
                    p.draft = Some(draft.clone());
                    let mut issues = vec![ReviewIssue {
                        code: "scope".into(),
                        detail: "x".into(),
                    }];
                    let padding =
                        MAX_INTERMEDIATE_BYTES - serde_json::to_vec(&issues).unwrap().len();
                    issues[0].detail.push_str(&"x".repeat(padding));
                    p.review = Some(Review {
                        approved: false,
                        repair_scope: Some(RepairScope::CandidateState),
                        issues: issues.clone(),
                        supports: vec![],
                        knowledge_supports: vec![],
                        reveal_supports: vec![],
                        memory_supports: vec![],
                    });
                    p.candidate = Some(candidate.clone());
                    if stage == Stage::Extract {
                        let mut state = serde_json::to_value(&candidate).unwrap();
                        for field in extraction::FROZEN_FIELDS {
                            state.as_object_mut().unwrap().remove(field);
                        }
                        p.repair_feedback = Some(json!({"candidate_state":state,"issues":issues}));
                    }
                    let result = p.next_request(&c);
                    if maximal {
                        assert_eq!(result.unwrap_err(), Invalid("stage_content_capacity"));
                        assert_eq!(p.calls(), 0);
                    } else {
                        let request = result.unwrap();
                        let actual = request.input.to_string().len()
                            + request.prompt.len()
                            + request.schema.to_string().len()
                            + SCHEMA_TRANSPORT_GROWTH_BYTES;
                        let bound =
                            serde_json::to_vec(&c).unwrap().len() + MAX_STAGE_OVERHEAD_BYTES;
                        eprintln!("{kind}/{} actual={actual} bound={bound}", stage.name());
                        assert!(actual <= bound);
                    }
                    assert!(p.draft.as_ref().unwrap().matches(&candidate));
                    assert_eq!(p.candidate.as_ref().unwrap(), &candidate);
                }
            }
        }
    }

    fn carrier_context(kind: &str) -> Context {
        let mut c = Context::decode(include_bytes!(
            "../tests/fixtures/experience-hidden-suffix.json"
        ))
        .unwrap();
        c.pipeline = Some(PipelineConfig {
            version: 1,
            max_actors: 2,
            max_repairs: 1,
        });
        c.mode = Mode::Act;
        c.input = "Inspect".into();
        if kind == "experience" {
            c.state.gameplay = Some(
                json!({"schemaVersion":1,"game":null,"location":"书店","inventory":[],"experience":{"schemaVersion":1,
                "clock":{"label":c.state.story_time,"elapsed":"","precision":"unknown","quote":"雨夜","sourceVersion":3},"objects":[],"stop":null,"folded":[]}}),
            );
        } else if kind == "game" {
            c.gameplay_action = Some(
                json!({"kind":"game","action_id":"inspect","result":"Observed","changes":[],"destination":null,"journey":null,"base_revision":3}),
            );
        }
        c.validate().unwrap();
        c
    }
    #[test]
    fn stage_schema_sizes_are_measured_for_the_shared_preflight_reservation() {
        for kind in ["ordinary", "experience", "game"] {
            let c = carrier_context(kind);
            for stage in [
                Stage::Memory,
                Stage::Actor,
                Stage::Plan,
                Stage::Evaluate,
                Stage::Write,
                Stage::Extract,
                Stage::RepairExtract,
                Stage::RepairState,
                Stage::Review,
                Stage::RepairReview,
                Stage::Revise,
                Stage::Answer,
            ] {
                let schema = stage_schema(stage, &c);
                let bytes = schema.to_string().len();
                eprintln!("v4.9 schema {kind}/{}={bytes}", stage.name());
                assert!(bytes <= MAX_STAGE_SCHEMA_BYTES);
                if matches!(
                    stage,
                    Stage::Extract | Stage::RepairExtract | Stage::RepairState
                ) {
                    assert_eq!(
                        schema["properties"]["result"]["anyOf"][0]["properties"]["candidate"]
                            ["$ref"],
                        "#/$defs/candidate"
                    );
                    assert_eq!(
                        schema["$defs"]["candidate"]["properties"]
                            .get("gameplay_update")
                            .is_some(),
                        kind != "ordinary"
                    );
                    assert_eq!(schema["$defs"].get("game_update").is_some(), kind == "game");
                }
            }
        }
    }
    #[test]
    fn maximal_frozen_draft_fits_all_active_carrier_schemas_without_plan_or_guide() {
        for kind in ["ordinary", "experience", "game"] {
            let c = carrier_context(kind);
            let draft = Draft {
                title: "t".repeat(256),
                passage: "x".repeat(8192),
                story_time: "n".repeat(512),
                outcome: Outcome::Continues,
                suggestions: vec!["s".repeat(512); 4],
            };
            draft.validate(&c).unwrap();
            for stage in [Stage::Extract, Stage::RepairExtract] {
                let mut p = Pipeline::new(&c, 12).unwrap();
                p.draft = Some(draft.clone());
                p.stage = stage;
                p.selected = Some(PlotCandidate {
                    id: "p".into(),
                    purpose: "p".repeat(1800),
                    beats: vec!["beat".into()],
                    causes: vec![],
                    costs: vec![],
                    consequences: vec![],
                    thread_ids: vec![],
                    fact_ids: vec![],
                });
                let request = p.next_request(&c).unwrap();
                assert!(request.input.get("candidate_format").is_none());
                assert!(request.input.get("selected_plan").is_none());
                assert_eq!(
                    request.input["draft"]["passage"].as_str().unwrap().len(),
                    8192
                );
                let aggregate = request.input.to_string().len()
                    + request.prompt.len()
                    + request.schema.to_string().len()
                    + SCHEMA_TRANSPORT_GROWTH_BYTES
                    - serde_json::to_vec(&c).unwrap().len();
                eprintln!(
                    "v4.9 maximal {kind}/{} aggregate={aggregate} schema={}",
                    stage.name(),
                    request.schema.to_string().len()
                );
                assert!(aggregate <= stage_overhead_bytes(&c));
            }
        }
    }
    #[test]
    fn escaped_draft_growth_fails_closed_instead_of_truncating() {
        let c = carrier_context("game");
        let draft = Draft {
            title: "t".repeat(256),
            passage: "\\".repeat(8192),
            story_time: "n".repeat(512),
            outcome: Outcome::Continues,
            suggestions: vec!["s".repeat(512); 4],
        };
        draft.validate(&c).unwrap();
        let mut p = Pipeline::new(&c, 12).unwrap();
        p.draft = Some(draft.clone());
        p.stage = Stage::Extract;
        let error = p.next_request(&c).unwrap_err();
        assert_eq!(error, Invalid("stage_content_capacity"));
        assert_eq!(p.failure_reason(error), "context_budget_exceeded");
        assert_eq!(p.draft.unwrap().passage, draft.passage);
        assert_eq!(p.calls, 0);
    }
    #[test]
    fn planning_and_revision_component_byte_bounds_fit_the_stage_reservation() {
        // Maximum encoded component envelopes test transport size, not story
        // quality. Each is padded to its producer's byte ceiling; semantic
        // references are exercised separately by the full pipeline tests.
        fn padded(mut value: Value, field: &str, bound: usize) -> Value {
            let remaining = bound - value.to_string().len();
            value[field] = json!("x".repeat(remaining));
            assert_eq!(value.to_string().len(), bound);
            value
        }
        for kind in ["ordinary", "experience", "game"] {
            let c = carrier_context(kind);
            let mut p = Pipeline::new(&c, 12).unwrap();
            p.scene = Some(
                serde_json::from_value(padded(
                    json!({
                        "actors": [{"actor_id":"actor-a", "trigger":"visible", "fact_ids":[]}],
                        "relevant_fact_ids":[], "objective":""
                    }),
                    "objective",
                    MAX_INTERMEDIATE_BYTES,
                ))
                .unwrap(),
            );
            p.actors = ["actor-a", "actor-b"]
                .into_iter()
                .map(|id| {
                    serde_json::from_value(padded(
                        json!({"actor_id":id,"intent":"i",
                    "action":"","speech":"","conditions":[],"used_fact_ids":[]}),
                        "action",
                        MAX_INTERMEDIATE_BYTES,
                    ))
                    .unwrap()
                })
                .collect();
            let plans: Vec<PlotCandidate> = ["a", "b", "c"]
                .into_iter()
                .map(|id| {
                    serde_json::from_value(padded(
                        json!({"id":id,"purpose":"","beats":["b"],
                    "causes":[],"costs":[],"consequences":[],"thread_ids":[],"fact_ids":[]}),
                        "purpose",
                        MAX_INTERMEDIATE_BYTES,
                    ))
                    .unwrap()
                })
                .collect();
            p.selected = Some(plans[0].clone());
            p.plans = Some(Plans { candidates: plans });
            p.draft = Some(Draft {
                title: "t".repeat(256),
                passage: "x".repeat(8192),
                story_time: "n".repeat(512),
                outcome: Outcome::Continues,
                suggestions: vec!["s".repeat(512); 4],
            });
            p.draft.as_ref().unwrap().validate(&c).unwrap();
            let issues = vec![serde_json::from_value(padded(
                json!({"code":"c","detail":""}),
                "detail",
                MAX_INTERMEDIATE_BYTES - 2,
            ))
            .unwrap()];
            assert_eq!(
                serde_json::to_vec(&issues).unwrap().len(),
                MAX_INTERMEDIATE_BYTES
            );
            p.review = Some(Review {
                repair_scope: None,
                memory_supports: vec![],
                approved: false,
                issues,
                supports: vec![],
                knowledge_supports: vec![],
                reveal_supports: vec![],
            });
            for stage in [
                Stage::Memory,
                Stage::Actor,
                Stage::Plan,
                Stage::Evaluate,
                Stage::Write,
                Stage::Revise,
                Stage::Answer,
            ] {
                p.stage = stage;
                p.pending = false;
                let req = p.next_request(&c).unwrap();
                let context_bytes = serde_json::to_vec(&c).unwrap().len();
                let bytes = req.input.to_string().len()
                    + req.prompt.len()
                    + req.schema.to_string().len()
                    + SCHEMA_TRANSPORT_GROWTH_BYTES;
                eprintln!(
                    "v4.9 {kind}/{} upper component overhead={}",
                    stage.name(),
                    bytes.saturating_sub(context_bytes)
                );
                assert!(bytes <= context_bytes + MAX_STAGE_OVERHEAD_BYTES);
            }
        }
    }
    #[test]
    fn maximal_frozen_candidate_is_reviewed_without_planning_proposals() {
        let mut c = Context::decode(include_bytes!(
            "../tests/fixtures/experience-hidden-suffix.json"
        ))
        .unwrap();
        c.pipeline = Some(PipelineConfig {
            version: 1,
            max_actors: 2,
            max_repairs: 1,
        });
        c.seed = "c".repeat(16 * 1024);
        let mut p = Pipeline::new(&c, 12).unwrap();
        let actor = |id: &str| ActorDecision {
            actor_id: id.into(),
            intent: "intent".into(),
            action: "a".repeat(1800),
            speech: String::new(),
            conditions: vec![],
            used_fact_ids: vec![],
        };
        p.actors = vec![actor("a"), actor("b")];
        p.scene = Some(SceneFrame {
            context_needs: None,
            actors: vec![],
            objective: "s".repeat(1800),
            relevant_fact_ids: vec![],
        });
        p.selected = Some(PlotCandidate {
            id: "p".into(),
            purpose: "p".repeat(1800),
            beats: vec![],
            causes: vec![],
            costs: vec![],
            consequences: vec![],
            thread_ids: vec![],
            fact_ids: vec![],
        });
        let draft = Draft {
            title: "t".into(),
            passage: "body".into(),
            story_time: "night".into(),
            outcome: Outcome::Continues,
            suggestions: vec![],
        };
        let mut candidate = draft.plain_candidate();
        candidate.new_facts.push(Fact {
            reader: None,
            id: "f".into(),
            kind: FactKind::Fact,
            text: "f".repeat(23 * 1024),
            subject_id: String::new(),
            known: true,
            source_revision: 4,
            known_by: vec![],
        });
        let padding = MAX_CANDIDATE_BYTES - serde_json::to_vec(&candidate).unwrap().len();
        candidate.new_facts[0].text.push_str(&"f".repeat(padding));
        assert_eq!(
            serde_json::to_vec(&candidate).unwrap().len(),
            MAX_CANDIDATE_BYTES
        );
        p.candidate = Some(candidate);
        for stage in [Stage::Review, Stage::RepairReview] {
            p.stage = stage;
            p.pending = false;
            let req = p.next_request(&c).unwrap();
            // The reviewer judges the original authorized request and frozen
            // candidate. Unexecuted proposals must not become obligations or
            // consume a second scene's capacity in this independent stage.
            for key in ["scene", "actors", "selected_plan"] {
                assert!(req.input.get(key).is_none(), "review received {key}");
            }
            assert_eq!(
                req.input["candidate"],
                serde_json::to_value(p.candidate.as_ref().unwrap()).unwrap()
            );
            assert_eq!(req.input["context"], context_view(&c, 0).unwrap());
            let context_bytes = serde_json::to_vec(&c).unwrap().len();
            let total =
                req.input.to_string().len() + req.prompt.len() + req.schema.to_string().len();
            eprintln!(
                "v4.9 {}/max-candidate aggregate={}",
                stage.name(),
                total + SCHEMA_TRANSPORT_GROWTH_BYTES - context_bytes
            );
            assert!(
                total + SCHEMA_TRANSPORT_GROWTH_BYTES <= context_bytes + MAX_STAGE_OVERHEAD_BYTES
            );
            assert!(total + 1024 < 65536 - 8192);
        }
    }
}

#[cfg(test)]
mod reading_scope_tests {
    use super::*;

    // These tests exercise emitted prompts and structural boundaries with fixed
    // inputs; they do not establish real-model prose length or literary quality.
    fn request_at(context: &Context, stage: Stage) -> StageRequest {
        let mut c = context.clone();
        c.pipeline = Some(PipelineConfig {
            version: 1,
            max_actors: 2,
            max_repairs: 1,
        });
        let mut pipeline = Pipeline::new(&c, 12).unwrap();
        pipeline.stage = stage;
        if stage == Stage::Actor {
            pipeline.scene = Some(SceneFrame {
                objective: "固定结构测试".into(),
                relevant_fact_ids: vec![],
                context_needs: None,
                actors: vec![ActorTrigger {
                    actor_id: "npc_restorer".into(),
                    trigger: "固定结构测试".into(),
                    fact_ids: vec![],
                }],
            });
        }
        pipeline.next_request(&c).unwrap()
    }

    fn context(mode: Mode) -> Context {
        let mut c = Context::decode(include_bytes!(
            "../tests/fixtures/experience-hidden-suffix.json"
        ))
        .unwrap();
        c.mode = mode;
        c
    }

    fn draft(c: &Context, passage: String) -> Draft {
        Draft {
            title: "有界叙述".into(),
            passage,
            story_time: c.state.story_time.clone(),
            outcome: Outcome::Continues,
            suggestions: vec![],
        }
    }

    #[test]
    fn read_accepts_natural_paragraphs_without_expanding_other_modes() {
        let read = context(Mode::Read);
        for count in [1, 3, 4, 24] {
            draft(&read, vec!["段落中的行动与对白。"; count].join("\n\n"))
                .validate(&read)
                .unwrap();
        }
        assert!(draft(&read, vec!["段"; 25].join("\n\n"))
            .validate(&read)
            .is_err());
        for mode in [Mode::Begin, Mode::Act, Mode::Ask] {
            let c = context(mode);
            draft(&c, vec!["段"; 3].join("\n\n")).validate(&c).unwrap();
            assert!(draft(&c, vec!["段"; 4].join("\n\n")).validate(&c).is_err());
        }
    }

    #[test]
    fn reading_keeps_utf8_bytes_and_empty_text_boundaries() {
        let read = context(Mode::Read);
        let exact = "汉".repeat(2730) + "ab";
        assert_eq!(exact.len(), 8192);
        draft(&read, exact.clone()).validate(&read).unwrap();
        assert!(draft(&read, exact + "c").validate(&read).is_err());
        assert!(draft(&read, "\n\n  \n\n".into()).validate(&read).is_err());
        draft(&read, vec!["段"; 24].join("\r\n\r\n"))
            .validate(&read)
            .unwrap();
    }

    #[test]
    fn default_read_delivers_one_length_policy_to_planning_and_writing() {
        let mut c = context(Mode::Read);
        c.seed = "雨夜的书店。叙述视角：第二人称；篇幅：适中。".into();
        for stage in [
            Stage::Memory,
            Stage::Plan,
            Stage::Evaluate,
            Stage::Write,
            Stage::Revise,
        ] {
            let request = request_at(&c, stage);
            assert!(request.prompt.contains("1200–1800汉字"), "{}", stage.name());
            assert!(request.prompt.contains("完整阅读片段"), "{}", stage.name());
            assert!(request.prompt.contains("适中/medium"), "{}", stage.name());
            assert!(!request.prompt.contains("默认短场景"), "{}", stage.name());
            assert!(
                !request.prompt.contains("默认1–3段短场景"),
                "{}",
                stage.name()
            );
        }
    }

    #[test]
    fn read_preserves_explicit_requests_and_preference_priority_without_a_length_floor() {
        let mut c = context(Mode::Read);
        c.reading_request = Some("这次只写一段简短的安静过渡。".into());
        c.preferences.push(Preference {
            dimension: "篇幅".into(),
            value: "希望舒展一些".into(),
            source: PreferenceSource::Explicit,
            evidence: "希望舒展一些".into(),
        });
        for stage in [Stage::Memory, Stage::Plan, Stage::Write, Stage::Revise] {
            let request = request_at(&c, stage);
            let sent_context = if stage == Stage::Memory {
                &request.input
            } else {
                &request.input["context"]
            };
            assert_eq!(
                sent_context["reading_request"],
                "这次只写一段简短的安静过渡。"
            );
            assert_eq!(sent_context["preferences"][0]["value"], "希望舒展一些");
            assert!(request.prompt.contains("reading_request优先"));
            assert!(request.prompt.contains("source=explicit"));
            assert!(request.prompt.contains("不因字数不足单独拒绝"));
        }
        // Review receives the original instructions and preferences, without
        // spending frozen-candidate capacity on a non-binding default target.
        for stage in [Stage::Review, Stage::RepairReview] {
            let request = request_at(&c, stage);
            assert_eq!(
                request.input["context"]["reading_request"],
                "这次只写一段简短的安静过渡。"
            );
            assert_eq!(
                request.input["context"]["preferences"][0]["value"],
                "希望舒展一些"
            );
            assert!(!request.prompt.contains("1200–1800汉字"));
        }
        draft(&c, "雨停了。".into()).validate(&c).unwrap();
    }

    #[test]
    fn reading_policy_does_not_enter_other_modes_or_actor_and_extraction_calls() {
        for mode in [Mode::Begin, Mode::Act, Mode::Ask] {
            let mut c = if mode == Mode::Begin {
                Context::decode(include_bytes!("../tests/fixtures/experience-context.json"))
                    .unwrap()
            } else {
                context(mode)
            };
            if matches!(mode, Mode::Act | Mode::Ask) {
                c.input = "固定结构测试".into();
            }
            if mode == Mode::Ask {
                c.state = known_information(&c.state);
                c.state_coverage.audience = Audience::Reader;
                c.state_coverage.total = StateCounts::default();
            }
            let stage = if mode == Mode::Ask {
                Stage::Answer
            } else {
                Stage::Write
            };
            let request = request_at(&c, stage);
            assert!(!request.prompt.contains("1200–1800汉字"));
            assert!(request.prompt.contains("1–3段"));
        }
        let c = context(Mode::Read);
        for stage in [Stage::Actor, Stage::Extract, Stage::RepairExtract] {
            assert!(!request_at(&c, stage).prompt.contains("1200–1800汉字"));
        }
    }
}
