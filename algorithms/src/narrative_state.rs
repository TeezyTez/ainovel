//! Private, versioned narrative notebook. All world assertions remain canonical facts.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PipelineConfig {
    pub version: u32,
    pub max_actors: u32,
    pub max_repairs: u32,
}
impl PipelineConfig {
    pub fn validate(&self) -> Checked<()> {
        require(
            self.version == 1 && self.max_actors <= 2 && self.max_repairs <= 1,
            "invalid_pipeline_config",
        )
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeState {
    pub version: u32,
    pub through_revision: u64,
    pub episodes: Vec<Episode>,
    pub characters: Vec<CharacterMemory>,
    pub arcs: Vec<NarrativeArc>,
    pub style: NarrativeStyle,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Episode {
    pub id: String,
    pub summary: String,
    pub from_revision: u64,
    pub to_revision: u64,
    pub fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CharacterMemory {
    pub entity_id: String,
    pub goals: Vec<String>,
    pub relationships: Vec<RelationshipMemory>,
    pub voice: String,
    pub belief_fact_ids: Vec<String>,
    pub updated_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RelationshipMemory {
    pub entity_id: String,
    pub stance: String,
    pub fact_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeArc {
    pub thread_id: String,
    pub status: String,
    pub tension: u32,
    pub next_beats: Vec<String>,
    pub payoff_conditions: Vec<String>,
    pub fact_ids: Vec<String>,
    pub updated_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NarrativeStyle {
    pub voice: String,
    pub perspective: String,
    pub pace: String,
    pub detail: String,
    pub avoid: Vec<String>,
    pub preference_refs: Vec<String>,
}
impl NarrativeState {
    pub fn validate(
        &self,
        state: &State,
        revision: u64,
        resolved: &[String],
        deferred: bool,
    ) -> Checked<()> {
        gameplay::shape(&serde_json::to_value(self).unwrap(), "narrative_state")
            .map_err(|_| Invalid("invalid_narrative_state"))?;
        require(
            self.version == 1 && self.through_revision <= revision,
            "narrative_revision_mismatch",
        )?;
        require(
            self.episodes.len() <= 8
                && self.characters.len() <= 16
                && self.arcs.len() <= 16
                && self.style.avoid.len() <= 8
                && self.style.preference_refs.len() <= 16
                && matches!(self.style.pace.as_str(), "slow" | "balanced" | "fast")
                && matches!(self.style.detail.as_str(), "brief" | "balanced" | "rich")
                && serde_json::to_vec(self)
                    .map_err(|_| Invalid("invalid_narrative_state"))?
                    .len()
                    <= super::pipeline::MAX_NOTEBOOK_BYTES,
            "invalid_narrative_state",
        )?;
        let facts: HashSet<_> = state.facts.iter().map(|f| f.id.as_str()).collect();
        let entities: HashSet<_> = state.entities.iter().map(|e| e.id.as_str()).collect();
        let threads: HashSet<_> = state.threads.iter().map(|t| t.id.as_str()).collect();
        let all = state_ids(state)?;
        let typed =
            |id: &str, ids: &HashSet<&str>| ids.contains(id) || (deferred && !all.contains(id));
        let fact_refs = |ids: &[String]| {
            deferred_references(ids.iter().map(String::as_str), &facts, &all, deferred)
        };
        unique(self.episodes.iter().map(|e| e.id.as_str()))?;
        unique(self.characters.iter().map(|c| c.entity_id.as_str()))?;
        unique(self.arcs.iter().map(|a| a.thread_id.as_str()))?;
        for episode in &self.episodes {
            require(
                nonempty(&episode.summary)
                    && episode.from_revision > 0
                    && episode.from_revision <= episode.to_revision
                    && episode.to_revision <= self.through_revision,
                "invalid_narrative_episode",
            )?;
            fact_refs(&episode.fact_ids)?;
            require(
                state
                    .facts
                    .iter()
                    .filter(|f| episode.fact_ids.contains(&f.id))
                    .all(|f| f.source_revision <= episode.to_revision),
                "narrative_episode_future_fact",
            )?;
        }
        for character in &self.characters {
            require(
                typed(&character.entity_id, &entities)
                    && character.goals.len() <= 4
                    && character.goals.iter().all(|v| nonempty(v))
                    && character.relationships.len() <= 8
                    && character.updated_revision > 0
                    && character.updated_revision <= self.through_revision,
                "invalid_character_memory",
            )?;
            require(
                state
                    .entities
                    .iter()
                    .find(|e| e.id == character.entity_id)
                    .map(|e| matches!(e.kind.as_str(), "character" | "person"))
                    .unwrap_or(deferred),
                "invalid_character_memory",
            )?;
            fact_refs(&character.belief_fact_ids)?;
            for id in &character.belief_fact_ids {
                require(
                    state
                        .facts
                        .iter()
                        .find(|f| f.id == *id)
                        .map(|f| {
                            f.subject_id == character.entity_id
                                && matches!(f.kind, FactKind::Statement | FactKind::Belief)
                        })
                        .unwrap_or(deferred),
                    "invalid_character_belief",
                )?;
            }
            unique(character.relationships.iter().map(|r| r.entity_id.as_str()))?;
            for relationship in &character.relationships {
                require(
                    typed(&relationship.entity_id, &entities)
                        && relationship.entity_id != character.entity_id
                        && nonempty(&relationship.stance),
                    "invalid_relationship_memory",
                )?;
                fact_refs(&relationship.fact_ids)?;
            }
        }
        for arc in &self.arcs {
            require(
                typed(&arc.thread_id, &threads)
                    && matches!(arc.status.as_str(), "open" | "resolved" | "abandoned")
                    && arc.tension <= 5
                    && arc.next_beats.len() <= 3
                    && arc.payoff_conditions.len() <= 4
                    && arc
                        .next_beats
                        .iter()
                        .chain(&arc.payoff_conditions)
                        .all(|v| nonempty(v))
                    && arc.updated_revision > 0
                    && arc.updated_revision <= self.through_revision,
                "invalid_narrative_arc",
            )?;
            if let Some(thread) = state.threads.iter().find(|t| t.id == arc.thread_id) {
                require(
                    (arc.status == "resolved")
                        == (resolved.contains(&arc.thread_id)
                            || thread.resolved_at_revision.flatten().is_some()),
                    "narrative_unresolved_arc",
                )?;
            }
            fact_refs(&arc.fact_ids)?;
        }
        require(
            self.style
                .avoid
                .iter()
                .chain(&self.style.preference_refs)
                .all(|v| nonempty(v)),
            "invalid_narrative_style",
        )?;
        Ok(())
    }
}
