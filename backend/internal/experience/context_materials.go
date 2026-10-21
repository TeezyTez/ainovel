package experience

import (
	"bytes"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"encoding/json"
	"sort"
	"strings"
	"unicode/utf8"
)

// ContextNeeds is a bounded search request, never an audience grant or evidence
// that a named character witnessed the current scene.
type ContextNeeds struct {
	ParticipantIDs      []string `json:"participant_ids"`
	RelationshipTargets []string `json:"relationship_targets"`
	Topics              []string `json:"topics"`
	OpenQuestions       []string `json:"open_questions"`
	FactIDs             []string `json:"fact_ids"`
	requiredMemoryIDs   []string
	requiredThreadIDs   []string
	derived             bool
}

type MaterialCoverage struct {
	Scope                  string   `json:"scope"`
	Matched                int      `json:"matched"`
	Returned               int      `json:"returned"`
	BudgetOmitted          int      `json:"budget_omitted"`
	Unqueried              []string `json:"unqueried"`
	Uncertain              []string `json:"uncertain"`
	HistoryComplete        bool     `json:"history_complete"`
	IndexedThroughRevision *int64   `json:"indexed_through_revision,omitempty"`
}

// MemoryMaterial is a reading representation; the complete source-bound entry
// remains in persistence. Granularity changes never cut an original sentence.
type MemoryMaterial struct {
	v2                   *memoryMaterialV2
	ID                   string         `json:"id"`
	Kind                 string         `json:"kind"`
	SubjectIDs           []string       `json:"subject_ids"`
	TargetIDs            []string       `json:"target_ids"`
	Cue                  string         `json:"cue"`
	Summary              string         `json:"summary,omitempty"`
	Status               string         `json:"status"`
	FactIDs              []string       `json:"fact_ids"`
	Quote                string         `json:"quote,omitempty"`
	SourceRevision       int64          `json:"source_revision"`
	SourceSHA256         string         `json:"source_sha256"`
	UpdatedRevision      int64          `json:"updated_revision"`
	Granularity          string         `json:"granularity"`
	RequiresSource       bool           `json:"requires_source"`
	PriorSources         []MemorySource `json:"prior_sources,omitempty"`
	PriorSourceCount     int            `json:"prior_source_count,omitempty"`
	PriorSourceRevisions []int64        `json:"prior_source_revisions,omitempty"`
}

func memoryMaterial(entry MemoryEntry, granularity string) MemoryMaterial {
	return memoryMaterialForTopics(entry, granularity, nil)
}

// The persisted source chain remains complete. The prompt receives a bounded
// directory containing its endpoints and the sources most relevant to this
// author-stage query; revision locators permit exact page reads later.
func memorySourceWindow(sources []MemorySource, topics []string) []MemorySource {
	ranked := append([]MemorySource(nil), sources...)
	score := func(source MemorySource) int {
		total := 0
		for _, topic := range topics {
			if topic != "" && strings.Contains(source.Quote, topic) {
				total++
			}
		}
		return total
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		a, b := score(ranked[i]), score(ranked[j])
		if a != b {
			return a > b
		}
		return ranked[i].Revision < ranked[j].Revision
	})
	if len(ranked) <= 32 {
		return ranked
	}
	selected := map[int64]bool{sources[0].Revision: true, sources[len(sources)-1].Revision: true}
	for _, source := range ranked {
		if len(selected) >= 32 {
			break
		}
		selected[source.Revision] = true
	}
	out := make([]MemorySource, 0, 32)
	for _, source := range ranked {
		if selected[source.Revision] {
			out = append(out, source)
		}
	}
	return out
}

func memoryMaterialForTopics(entry MemoryEntry, granularity string, topics []string) MemoryMaterial {
	out := MemoryMaterial{ID: entry.ID, Kind: entry.Kind, SubjectIDs: entry.SubjectIDs, TargetIDs: entry.TargetIDs,
		Cue: entry.Cue, Status: entry.Status, FactIDs: entry.FactIDs, SourceRevision: entry.SourceRevision,
		SourceSHA256: entry.SourceSHA256, UpdatedRevision: entry.UpdatedRevision, Granularity: granularity}
	window := memorySourceWindow(entry.PriorSources, topics)
	out.PriorSourceCount = len(entry.PriorSources)
	for _, source := range window {
		out.PriorSourceRevisions = append(out.PriorSourceRevisions, source.Revision)
	}
	sort.Slice(out.PriorSourceRevisions, func(i, j int) bool { return out.PriorSourceRevisions[i] < out.PriorSourceRevisions[j] })
	if granularity == "summary" || granularity == "source" {
		out.Summary = entry.Summary
	}
	if granularity == "source" {
		out.Quote = entry.Quote
		out.PriorSources = window
	}
	out.RequiresSource = granularity == "cue" ||
		(granularity == "source" && len(out.PriorSources) < out.PriorSourceCount) ||
		(granularity != "source" && (len(entry.PriorSources) > 0 || entry.Kind == "commitment" || entry.Kind == "expression" || entry.Kind == "relationship"))
	return out
}

// Memory interpretations and the old unscoped notebook are author material.
// ActorFacts has a different wire type so known_by/reader metadata cannot leak.
type ContextBundle struct {
	Stage            string               `json:"stage"`
	ActorID          string               `json:"actor_id,omitempty"`
	BaseRevision     int64                `json:"base_revision"`
	Facts            []Fact               `json:"facts,omitempty"`
	ActorFacts       []narrativeActorFact `json:"actor_facts,omitempty"`
	Memories         []MemoryMaterial     `json:"memories,omitempty"`
	LegacyCharacters []NarrativeCharacter `json:"legacy_characters,omitempty"`
	LegacyEpisodes   []NarrativeEpisode   `json:"legacy_episodes,omitempty"`
	LegacyArcs       []NarrativeArc       `json:"legacy_arcs,omitempty"`
	Coverage         MaterialCoverage     `json:"coverage"`
}

const defaultMaterialBudget = 12 << 10

func (n ContextNeeds) validate() error {
	for index, values := range [][]string{n.ParticipantIDs, n.RelationshipTargets, n.Topics, n.OpenQuestions, n.FactIDs} {
		maxItems, maxChars := 8, 128
		if n.derived {
			maxItems, maxChars = 512, 512
		}
		if index == 3 {
			maxChars = 256
		}
		if index == 4 && !n.derived {
			maxItems = 32
		}
		if len(values) > maxItems {
			return fail("narrative_material_needs_invalid")
		}
		for _, value := range values {
			if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > maxChars {
				return fail("narrative_material_needs_invalid")
			}
		}
	}
	return nil
}

func stringSet(values ...[]string) map[string]bool {
	out := map[string]bool{}
	for _, list := range values {
		for _, id := range list {
			out[id] = true
		}
	}
	return out
}
func containsID(values []string, id string) bool {
	for _, value := range values {
		if value == id {
			return true
		}
	}
	return false
}
func intersectsIDs(values []string, ids map[string]bool) bool {
	for _, value := range values {
		if ids[value] {
			return true
		}
	}
	return false
}
func (p *narrativeRun) authority() State {
	if p.context.AuthorityState != nil {
		return *p.context.AuthorityState
	}
	return p.context.State
}

// prepareMaterials always starts from the pinned authority, not the lossy entry
// view or the previous stage's selection. Scores express this scene's use, not
// a permanent importance score attached to someone's life.
func (p *narrativeRun) prepareMaterials(stage, actorID string, needs ContextNeeds, budget int) (ContextBundle, error) {
	out := ContextBundle{Stage: stage, ActorID: actorID, BaseRevision: p.context.Revision,
		Coverage: MaterialCoverage{Scope: "current_authority_scene_selection", Unqueried: []string{"unselected_history_pages"}, Uncertain: []string{"absence_from_selection_does_not_mean_nonexistence"}}}
	if err := needs.validate(); err != nil {
		return out, err
	}
	if budget <= 0 {
		budget = defaultMaterialBudget
	}
	state := p.authority()
	if p.context.Mode == "ask" {
		state = ReaderState(state)
	}
	if actorID == "" && p.context.Mode != "ask" {
		indexed := int64(0)
		if state.LiteraryMemory != nil {
			indexed = state.LiteraryMemory.IndexedThroughRevision
		}
		out.Coverage.IndexedThroughRevision = &indexed
		if indexed < p.context.Revision {
			out.Coverage.Unqueried = append(out.Coverage.Unqueried, "pages_from_"+jsonNumber(indexed+1))
			out.Coverage.Uncertain = append(out.Coverage.Uncertain, "index_gap_is_not_evidence_of_absence")
		}
	}
	participants := stringSet(needs.ParticipantIDs, needs.RelationshipTargets)
	required := stringSet(needs.FactIDs)
	requiredMemories := stringSet(needs.requiredMemoryIDs)
	topics := append(append([]string{}, needs.Topics...), needs.OpenQuestions...)
	if actorID != "" {
		// Director free text is not an actor search query. Only authorized facts
		// and structural self/relationship links participate in this ranking.
		out.Coverage.Scope = "current_actor_known_facts_selection"
		out.Coverage.Unqueried = []string{"unselected_known_facts"}
		out.Coverage.Uncertain = []string{"selection_is_not_complete_knowledge"}
		topics = nil
		participants = stringSet([]string{actorID})
	}
	type factPick struct {
		fact     Fact
		score    int
		group    string
		required bool
	}
	picks := []factPick{}
	available := map[string]bool{}
	for _, f := range state.Facts {
		if f.SourceRevision > p.context.Revision || actorID != "" && !containsID(f.KnownBy, actorID) {
			continue // Permission and time precede matching, ranking and counts.
		}
		available[f.ID] = true
		score, group := 0, "other"
		if required[f.ID] {
			score, group = 1000, "required"
		}
		if f.Kind == "rule" {
			score, group = max(score, 900), "required"
		}
		if participants[f.SubjectID] {
			score, group = max(score, 210), f.SubjectID
		}
		if f.Reader != nil && (participants[f.Reader.EntityID] || participants[f.Reader.TargetID]) {
			score = max(score, 210)
			group = f.Reader.EntityID
		}
		for _, topic := range topics {
			if strings.Contains(f.Text, topic) || strings.Contains(f.ID, topic) {
				score += 40
			}
		}
		// Formal fact kinds do not classify personality. Use authorized subject
		// and entity links; only the author's derived index has literary kinds.
		for _, entity := range state.Entities {
			if participants[entity.ID] && containsID(entity.RelatedIDs, f.ID) {
				score = max(score, 230)
				group = entity.ID
			}
		}
		if actorID != "" && score == 0 {
			score = 10 // Other known evidence is eligible after personal context.
		}
		if stage == "memory" && f.SourceRevision >= p.context.Revision-1 {
			score = max(score, 80)
		}
		if score > 0 {
			picks = append(picks, factPick{f, score, group, required[f.ID] || f.Kind == "rule"})
		}
	}
	for id := range required {
		if !available[id] {
			// Unknown and unauthorized IDs intentionally have the same failure.
			return out, fail("narrative_material_reference_invalid")
		}
	}
	sort.SliceStable(picks, func(i, j int) bool {
		if picks[i].score != picks[j].score {
			return picks[i].score > picks[j].score
		}
		// For equally relevant personal facts, keep both foundational evidence
		// and recent changes through the alternating group queue below.
		return picks[i].fact.SourceRevision < picks[j].fact.SourceRevision
	})
	// Within each equal-priority subject, alternate earliest/latest. Otherwise
	// a pile of routine recent work replaces the person's older identity, or
	// an old impression crowds out evidence of a later change.
	for first := 0; first < len(picks); {
		last := first + 1
		for last < len(picks) && picks[last].score == picks[first].score {
			last++
		}
		groups, order := map[string][]factPick{}, []string{}
		for _, pick := range picks[first:last] {
			if _, ok := groups[pick.group]; !ok {
				order = append(order, pick.group)
			}
			groups[pick.group] = append(groups[pick.group], pick)
		}
		at, recent := first, false
		for at < last {
			for _, group := range order {
				queue := groups[group]
				if len(queue) == 0 {
					continue
				}
				index := 0
				if recent {
					index = len(queue) - 1
				}
				picks[at] = queue[index]
				groups[group] = append(queue[:index], queue[index+1:]...)
				at++
			}
			recent = !recent
		}
		first = last
	}
	type memoryPick struct {
		entry MemoryEntry
		score int
	}
	memories := []memoryPick{}
	availableMemories := map[string]bool{}
	if actorID == "" && p.context.Mode != "ask" && state.LiteraryMemory != nil {
		for _, m := range state.LiteraryMemory.Entries {
			if m.SourceRevision > p.context.Revision || m.UpdatedRevision > p.context.Revision {
				continue
			}
			availableMemories[m.ID] = true
			score := 0
			involved := intersectsIDs(m.SubjectIDs, participants) || intersectsIDs(m.TargetIDs, participants)
			if involved {
				score = 100
			}
			if involved && (m.Kind == "relationship" || m.Kind == "commitment") {
				score += 50
			}
			if involved && (m.Kind == "disposition" || m.Kind == "goal" || m.Kind == "expression") {
				score += 30
			}
			if involved && m.Status == "active" {
				score += 10
			}
			if intersectsIDs(m.FactIDs, required) {
				score += 100
			}
			if requiredMemories[m.ID] {
				score = 1000
			}
			for _, term := range topics {
				if strings.Contains(m.Cue, term) || strings.Contains(m.Summary, term) || containsID(m.RetrievalKeys, term) {
					score += 30
				}
			}
			if score > 0 {
				memories = append(memories, memoryPick{m, score})
			}
		}
		sort.SliceStable(memories, func(i, j int) bool {
			if memories[i].score != memories[j].score {
				return memories[i].score > memories[j].score
			}
			return memories[i].entry.UpdatedRevision > memories[j].entry.UpdatedRevision
		})
	}
	for id := range requiredMemories {
		if !availableMemories[id] {
			return out, fail("narrative_material_reference_invalid")
		}
	}
	for _, pick := range memories {
		if pick.entry.Kind == "commitment" && pick.entry.Status == "active" && !requiredMemories[pick.entry.ID] {
			// Being associated with a participant does not make every old
			// promise essential to this scene. Reserve the honesty note before
			// packing so recording an omission cannot itself exceed the budget.
			out.Coverage.Uncertain = append(out.Coverage.Uncertain, "selection_may_omit_other_active_commitments")
			break
		}
	}
	legacy := []NarrativeCharacter{}
	legacyEpisodes := []NarrativeEpisode{}
	legacyArcs := []NarrativeArc{}
	if actorID == "" && p.context.Mode != "ask" && state.Narrative != nil && state.Narrative.ThroughRevision <= p.context.Revision {
		relatedFacts := stringSet(needs.FactIDs)
		for _, fact := range state.Facts {
			if participants[fact.SubjectID] {
				relatedFacts[fact.ID] = true
			}
			if fact.Reader != nil && (participants[fact.Reader.EntityID] || participants[fact.Reader.TargetID]) {
				relatedFacts[fact.ID] = true
			}
		}
		for _, entity := range state.Entities {
			if participants[entity.ID] {
				for _, id := range entity.RelatedIDs {
					relatedFacts[id] = true
				}
			}
		}
		matchesTopic := func(text string) bool {
			for _, topic := range topics {
				if strings.Contains(text, topic) {
					return true
				}
			}
			return false
		}
		relatedThreads := stringSet(needs.requiredThreadIDs)
		for _, thread := range state.Threads {
			if intersectsIDs(thread.RelatedFactIDs, relatedFacts) || matchesTopic(thread.Text) {
				relatedThreads[thread.ID] = true
			}
		}
		for _, ch := range state.Narrative.Characters {
			if participants[ch.EntityID] && ch.UpdatedRevision <= p.context.Revision {
				legacy = append(legacy, ch)
			}
		}
		for _, episode := range state.Narrative.Episodes {
			if episode.ToRevision <= p.context.Revision && (intersectsIDs(episode.FactIDs, relatedFacts) || matchesTopic(episode.Summary)) {
				legacyEpisodes = append(legacyEpisodes, episode)
			}
		}
		for _, arc := range state.Narrative.Arcs {
			if arc.UpdatedRevision <= p.context.Revision && (intersectsIDs(arc.FactIDs, relatedFacts) || relatedThreads[arc.ThreadID] ||
				matchesTopic(strings.Join(arc.NextBeats, "\n")+"\n"+strings.Join(arc.PayoffConditions, "\n"))) {
				legacyArcs = append(legacyArcs, arc)
			}
		}
		if len(legacy)+len(legacyEpisodes)+len(legacyArcs) > 0 {
			out.Coverage.Uncertain = append(out.Coverage.Uncertain, "legacy_unverified_summary_requires_sources")
		}
	}
	out.Coverage.Matched = len(picks) + len(memories) + len(legacy) + len(legacyEpisodes) + len(legacyArcs)
	fits := func() bool { return len(narrativeMarshal(out)) <= budget }
	acceptFact := func(pick factPick) error {
		if actorID == "" {
			out.Facts = append(out.Facts, pick.fact)
		} else {
			f := pick.fact
			out.ActorFacts = append(out.ActorFacts, narrativeActorFact{f.ID, f.Kind, f.Text, f.SubjectID, f.SourceRevision})
		}
		out.Coverage.Returned++
		if fits() {
			return nil
		}
		out.Coverage.Returned--
		if actorID == "" {
			out.Facts = out.Facts[:len(out.Facts)-1]
		} else {
			out.ActorFacts = out.ActorFacts[:len(out.ActorFacts)-1]
		}
		if pick.required {
			return fail("context_budget_exceeded")
		}
		out.Coverage.BudgetOmitted++
		return nil
	}
	// Preserve causal constraints first. Reserve a share for authored memories
	// rather than allowing dozens of facts about one recent task to consume it.
	split := 0
	for split < len(picks) && picks[split].required {
		if err := acceptFact(picks[split]); err != nil {
			return out, err
		}
		split++
	}
	factLimit := budget
	if len(memories)+len(legacy)+len(legacyEpisodes)+len(legacyArcs) > 0 {
		factLimit = max(len(narrativeMarshal(out)), budget*2/3)
	}
	for _, pick := range picks[split:] {
		oldBudget := budget
		budget = factLimit
		err := acceptFact(pick)
		budget = oldBudget
		if err != nil {
			return out, err
		}
	}
	selectedMemorySources := []MemoryEntry{}
	for _, pick := range memories {
		levels := []string{"summary", "cue"}
		if pick.entry.Kind == "commitment" || pick.entry.Kind == "expression" || pick.entry.Kind == "relationship" {
			levels = []string{"source", "summary", "cue"}
		}
		if requiredMemories[pick.entry.ID] {
			levels = []string{"source"}
		}
		accepted := false
		for _, level := range levels {
			material := memoryMaterialForTopics(pick.entry, level, topics)
			if p.evidenceV2 || pick.entry.EvidenceKind == "source_refs_v2" {
				var err error
				material.v2, err = memoryV2Material(pick.entry, level)
				if err != nil {
					return out, err
				}
			}
			unqueriedBefore, uncertainBefore := len(out.Coverage.Unqueried), len(out.Coverage.Uncertain)
			markPartial := func(m MemoryMaterial) {
				appendOnce := func(target *[]string, value string) {
					if !containsID(*target, value) {
						*target = append(*target, value)
					}
				}
				if len(m.PriorSourceRevisions) < m.PriorSourceCount {
					appendOnce(&out.Coverage.Unqueried, "memory_prior_source_directory_partial")
					appendOnce(&out.Coverage.Uncertain, "source_directory_is_not_complete_history")
				}
				if len(m.PriorSources) < m.PriorSourceCount {
					appendOnce(&out.Coverage.Unqueried, "memory_prior_source_quotes_omitted")
					appendOnce(&out.Coverage.Uncertain, "read_relevant_prior_pages_before_asserting_unseen_details")
				}
			}
			out.Memories = append(out.Memories, material)
			out.Coverage.Returned++
			markPartial(material)
			if !fits() && level == "source" && len(material.PriorSources) > 0 {
				// Keep the current quoted source and locators. Old sources are
				// added whole in query/earliest order; no excerpt is truncated
				// and no omitted source is deleted from the stored index.
				out.Memories[len(out.Memories)-1].PriorSources = nil
				out.Memories[len(out.Memories)-1].RequiresSource = true
				markPartial(out.Memories[len(out.Memories)-1])
				if fits() {
					for _, source := range material.PriorSources {
						selected := &out.Memories[len(out.Memories)-1]
						selected.PriorSources = append(selected.PriorSources, source)
						selected.RequiresSource = len(selected.PriorSources) < selected.PriorSourceCount
						if !fits() {
							selected.PriorSources = selected.PriorSources[:len(selected.PriorSources)-1]
							selected.RequiresSource = true
						}
					}
				}
			}
			if fits() {
				selectedMemorySources = append(selectedMemorySources, pick.entry)
				accepted = true
				break
			}
			out.Memories = out.Memories[:len(out.Memories)-1]
			out.Coverage.Returned--
			out.Coverage.Unqueried = out.Coverage.Unqueried[:unqueriedBefore]
			out.Coverage.Uncertain = out.Coverage.Uncertain[:uncertainBefore]
		}
		if !accepted {
			if requiredMemories[pick.entry.ID] {
				return out, fail("context_budget_exceeded")
			}
			out.Coverage.BudgetOmitted++
		}
	}
	for _, ch := range legacy {
		out.LegacyCharacters = append(out.LegacyCharacters, ch)
		out.Coverage.Returned++
		if !fits() {
			out.LegacyCharacters = out.LegacyCharacters[:len(out.LegacyCharacters)-1]
			out.Coverage.Returned--
			out.Coverage.BudgetOmitted++
		}
	}
	for _, episode := range legacyEpisodes {
		out.LegacyEpisodes = append(out.LegacyEpisodes, episode)
		out.Coverage.Returned++
		if !fits() {
			out.LegacyEpisodes = out.LegacyEpisodes[:len(out.LegacyEpisodes)-1]
			out.Coverage.Returned--
			out.Coverage.BudgetOmitted++
		}
	}
	for _, arc := range legacyArcs {
		out.LegacyArcs = append(out.LegacyArcs, arc)
		out.Coverage.Returned++
		if !fits() {
			out.LegacyArcs = out.LegacyArcs[:len(out.LegacyArcs)-1]
			out.Coverage.Returned--
			out.Coverage.BudgetOmitted++
		}
	}
	if !fits() {
		return out, fail("context_budget_exceeded")
	}
	if p.materialSource != nil {
		factIDs, memoryIDs := []string{}, []string{}
		for _, f := range out.Facts {
			factIDs = append(factIDs, f.ID)
		}
		for _, f := range out.ActorFacts {
			factIDs = append(factIDs, f.ID)
		}
		for _, m := range selectedMemorySources {
			memoryIDs = append(memoryIDs, m.ID)
		}
		source, err := p.materialSource(actorID, factIDs, memoryIDs)
		if err != nil {
			return out, err
		}
		factsByID, memoryByID := map[string]Fact{}, map[string]MemoryEntry{}
		for _, f := range source.Facts {
			factsByID[f.ID] = f
		}
		if source.LiteraryMemory != nil {
			for _, m := range source.LiteraryMemory.Entries {
				memoryByID[m.ID] = m
			}
		}
		for _, f := range out.Facts {
			if !bytes.Equal(narrativeMarshal(factsByID[f.ID]), narrativeMarshal(f)) {
				return out, fail("recall_scope_mismatch")
			}
		}
		for _, f := range out.ActorFacts {
			sourceFact, ok := factsByID[f.ID]
			if !ok || !containsID(sourceFact.KnownBy, actorID) || sourceFact.SourceRevision > p.context.Revision ||
				!bytes.Equal(narrativeMarshal(f), narrativeMarshal(narrativeActorFact{sourceFact.ID, sourceFact.Kind, sourceFact.Text, sourceFact.SubjectID, sourceFact.SourceRevision})) {
				return out, fail("recall_scope_mismatch")
			}
		}
		for _, m := range selectedMemorySources {
			if !bytes.Equal(narrativeMarshal(memoryByID[m.ID]), narrativeMarshal(m)) {
				return out, fail("recall_scope_mismatch")
			}
		}
	}
	return out, nil
}

func (p *narrativeRun) needsForStage(stage string, candidate *Candidate) ContextNeeds {
	needs := p.needs
	needs.derived = true
	needs.ParticipantIDs = append([]string{}, needs.ParticipantIDs...)
	needs.FactIDs = append([]string{}, needs.FactIDs...)
	for id, trigger := range p.actors {
		needs.ParticipantIDs = append(needs.ParticipantIDs, id)
		needs.FactIDs = append(needs.FactIDs, trigger.FactIDs...)
	}
	state := p.authority()
	if stage == "plan" || stage == "evaluate" || stage == "write" || stage == "revise" {
		needs.FactIDs = append(needs.FactIDs, p.actorUsedFactIDs...)
	}
	if stage == "evaluate" || stage == "write" || stage == "revise" {
		factIDs, threadIDs := p.planFactIDs, p.planThreadIDs
		if stage != "evaluate" && p.selectedPlanID != "" {
			selected := p.plans[p.selectedPlanID]
			factIDs, threadIDs = selected.FactIDs, selected.ThreadIDs
		}
		needs.FactIDs = append(needs.FactIDs, factIDs...)
		needs.requiredThreadIDs = append([]string{}, threadIDs...)
		for _, th := range state.Threads {
			if containsID(needs.requiredThreadIDs, th.ID) {
				needs.FactIDs = append(needs.FactIDs, th.RelatedFactIDs...)
			}
		}
	}
	text := p.context.Input + "\n" + p.context.ReadingRequest
	if len(p.context.History) > 0 {
		text += "\n" + p.context.History[len(p.context.History)-1].Text
	}
	if candidate != nil {
		if stage == "revise" {
			// Keep ordinary drafting/plan needs and the rejected state's
			// authoritative targets. A target visible in the entry carrier
			// must not disappear when the writer's working set is rebuilt.
			text += "\n" + candidate.Passage
		} else {
			// Review derives its subjects independently from the actual frozen page.
			text = candidate.Passage
			needs = ContextNeeds{derived: true}
		}
		for _, f := range candidate.NewFacts {
			if f.SubjectID != "" {
				needs.ParticipantIDs = append(needs.ParticipantIDs, f.SubjectID)
			}
			needs.ParticipantIDs = append(needs.ParticipantIDs, f.KnownBy...)
			if f.Reader != nil {
				needs.ParticipantIDs = append(needs.ParticipantIDs, f.Reader.EntityID, f.Reader.TargetID)
			}
		}
		for _, k := range candidate.KnowledgeChanges {
			needs.ParticipantIDs = append(needs.ParticipantIDs, k.SubjectID)
			for _, f := range state.Facts {
				if f.ID == k.FactID {
					needs.FactIDs = append(needs.FactIDs, f.ID)
				}
			}
		}
		needs.FactIDs = append(needs.FactIDs, candidate.RevealFactIDs...)
		existingFacts := map[string]bool{}
		for _, f := range state.Facts {
			existingFacts[f.ID] = true
		}
		changes := append([]MemoryChange(nil), candidate.MemoryChanges...)
		if candidate.MemoryDelta != nil {
			for _, entry := range candidate.MemoryDelta.Entries {
				changes = append(changes, interpretationChange(entry))
			}
		}
		for _, change := range changes {
			needs.ParticipantIDs = append(needs.ParticipantIDs, change.SubjectIDs...)
			needs.RelationshipTargets = append(needs.RelationshipTargets, change.TargetIDs...)
			// These keys describe the proposed author-side interpretation.
			// They guide source selection, never an actor's knowledge/ranking.
			needs.Topics = append(needs.Topics, change.RetrievalKeys...)
			for _, id := range change.FactIDs {
				if existingFacts[id] {
					needs.FactIDs = append(needs.FactIDs, id)
				}
			}
			if state.LiteraryMemory != nil {
				for _, old := range state.LiteraryMemory.Entries {
					if old.ID == change.ID {
						needs.requiredMemoryIDs = append(needs.requiredMemoryIDs, old.ID)
						for _, id := range old.FactIDs {
							if existingFacts[id] {
								needs.FactIDs = append(needs.FactIDs, id)
							}
						}
					}
				}
			}
		}
		if stage == "extract" && p.repairSource != nil && p.draft != nil {
			// Feedback describes rejected state, while extraction concerns the
			// adopted revision. Both may name existing people whose records
			// are needed. Draft words are lookup cues, never authoritative facts.
			text += "\n" + p.draft.Passage
		}
	}
	for _, e := range state.Entities {
		if e.Name != "" && strings.Contains(text, e.Name) || strings.Contains(text, e.ID) {
			needs.ParticipantIDs = append(needs.ParticipantIDs, e.ID)
		}
	}
	if p.readCompleted && len(p.context.Recalls) > 0 {
		for _, obj := range p.context.Recalls[len(p.context.Recalls)-1].Objects {
			if obj.AsOfRevision != p.context.Revision {
				continue
			}
			switch obj.Type {
			case "fact":
				var f Fact
				if json.Unmarshal(obj.Body, &f) == nil {
					needs.FactIDs = append(needs.FactIDs, f.ID)
				}
			case "entity":
				var e Entity
				if json.Unmarshal(obj.Body, &e) == nil {
					needs.ParticipantIDs = append(needs.ParticipantIDs, e.ID)
				}
			case "thread":
				var th Thread
				if json.Unmarshal(obj.Body, &th) == nil {
					needs.requiredThreadIDs = append(needs.requiredThreadIDs, th.ID)
					for _, source := range state.Threads {
						if source.ID == th.ID {
							needs.FactIDs = append(needs.FactIDs, source.RelatedFactIDs...)
						}
					}
				}
			}
		}
	}
	normalize := func(ids []string) []string {
		out, seen := []string{}, map[string]bool{}
		for _, id := range ids {
			if id != "" && !seen[id] {
				out, seen[id] = append(out, id), true
			}
		}
		return out
	}
	needs.ParticipantIDs, needs.FactIDs = normalize(needs.ParticipantIDs), normalize(needs.FactIDs)
	needs.Topics, needs.RelationshipTargets = normalize(needs.Topics), normalize(needs.RelationshipTargets)
	return needs
}

// replaceStageMaterials rewrites each stage's working set. It does not append
// every previous recall or the complete notebook to subsequent model calls.
func (p *narrativeRun) replaceStageMaterials(body map[string]json.RawMessage, stage string, candidate *Candidate) error {
	if p.context.Mode == "ask" {
		return nil
	}
	var view map[string]json.RawMessage
	nested := body["context"] != nil
	if nested {
		if json.Unmarshal(body["context"], &view) != nil {
			return fail("narrative_stage_invalid")
		}
	} else {
		view = body
	}
	// Sparse unit fixtures without a context are left to their existing shape
	// validator. Real protocol requests always contain a state object.
	if view["state"] == nil {
		return nil
	}
	budget := p.materialBudget
	if budget <= 0 {
		budget = defaultMaterialBudget
	}
	bundle, err := p.prepareMaterials(stage, "", p.needsForStage(stage, candidate), budget)
	if err != nil {
		return err
	}
	state := EmptyState()
	authority := p.authority()
	state.StoryTime, state.Gameplay = authority.StoryTime, authority.Gameplay
	state.Facts = bundle.Facts
	if state.Facts == nil {
		state.Facts = []Fact{}
	}
	entities := map[string]bool{}
	for _, id := range p.needsForStage(stage, candidate).ParticipantIDs {
		entities[id] = true
	}
	for _, f := range state.Facts {
		entities[f.SubjectID] = true
		for _, id := range f.KnownBy {
			entities[id] = true
		}
		if f.Reader != nil {
			entities[f.Reader.EntityID], entities[f.Reader.TargetID] = true, true
		}
	}
	for _, e := range authority.Entities {
		inEntry := false
		if stage == "memory" {
			for _, entry := range p.context.State.Entities {
				if entry.ID == e.ID {
					inEntry = true
					break
				}
			}
		}
		if entities[e.ID] || inEntry {
			state.Entities = append(state.Entities, e)
		}
	}
	selectedFacts := map[string]bool{}
	for _, f := range state.Facts {
		selectedFacts[f.ID] = true
	}
	for _, th := range authority.Threads {
		inEntry := false
		if stage == "memory" {
			for _, entry := range p.context.State.Threads {
				if entry.ID == th.ID {
					inEntry = true
					break
				}
			}
		}
		if inEntry || intersectsIDs(th.RelatedFactIDs, selectedFacts) || containsID(p.needsForStage(stage, candidate).requiredThreadIDs, th.ID) {
			state.Threads = append(state.Threads, th)
		}
	}
	view["state"] = narrativeMarshal(state)
	coverage := p.context.StateCoverage
	coverage.Total = counts(authority)
	coverage.Omitted = subtract(coverage.Total, counts(state))
	coverage.Complete = coverage.Omitted == (StateCounts{})
	coverage.Policy = "stage-scene-selection.v1"
	coverage.RecentFromRevision = 0 // This selection does not promise every recent root.
	if coverage.OmittedReaderKnown != nil {
		omittedReader := subtract(counts(ReaderState(authority)), counts(ReaderState(state)))
		coverage.OmittedReaderKnown = &omittedReader
	}
	view["state_coverage"] = narrativeMarshal(coverage)
	// Raw pages returned by an explicit same-stage read remain available only
	// for that continuation, not automatically through every later phase.
	view["historical_recalls"] = json.RawMessage("[]")
	if p.readCompleted && len(p.context.Recalls) > 0 {
		view["historical_recalls"] = narrativeMarshal(p.context.Recalls[len(p.context.Recalls)-1:])
	}
	bundle.Facts = nil // Already in state; never pay for a duplicate fact copy.
	body["context_materials"] = narrativeMarshal(bundle)
	if nested {
		body["context"] = narrativeMarshal(view)
	}
	return nil
}

// The Rust pipeline may defer IDs omitted by its entry view. Resolve that
// deferral against exactly the authoritative records sent in this model call,
// rather than merely accepting an ID that exists somewhere in storage.
func (p *narrativeRun) recordStageReferences(call *pb.ModelCallRequest) error {
	p.stageFacts, p.stageThreads = map[string]bool{}, map[string]bool{}
	facts, threads := map[string]Fact{}, map[string]Thread{}
	for _, f := range p.authority().Facts {
		if f.SourceRevision <= p.context.Revision {
			facts[f.ID] = f
		}
	}
	for _, th := range p.authority().Threads {
		threads[th.ID] = th
	}
	for _, message := range call.Messages {
		if message == nil || message.Role != "user" {
			continue
		}
		var body map[string]json.RawMessage
		if StrictJSON([]byte(message.Content), &body) != nil {
			return fail("narrative_stage_invalid")
		}
		if body["context"] != nil {
			var nested map[string]json.RawMessage
			if StrictJSON(body["context"], &nested) != nil {
				return fail("narrative_stage_invalid")
			}
			body = nested
		}
		if body["state"] == nil {
			continue
		}
		var state State
		if StrictJSON(body["state"], &state) != nil {
			return fail("narrative_stage_invalid")
		}
		for _, f := range state.Facts {
			source, ok := facts[f.ID]
			if !ok || !bytes.Equal(narrativeMarshal(source), narrativeMarshal(f)) {
				return fail("narrative_material_reference_invalid")
			}
			p.stageFacts[f.ID] = true
		}
		for _, th := range state.Threads {
			source, ok := threads[th.ID]
			if !ok || !bytes.Equal(narrativeMarshal(source), narrativeMarshal(th)) {
				return fail("narrative_material_reference_invalid")
			}
			p.stageThreads[th.ID] = true
		}
	}
	return nil
}

func narrativeCallBytes(call *pb.ModelCallRequest) int {
	size := len(call.SchemaJson)
	for _, m := range call.Messages {
		if m != nil {
			size += len(m.Content)
		}
	}
	return size
}

func (p *narrativeRun) compileStageCall(call *pb.ModelCallRequest, stage string) error {
	original := make([]string, len(call.Messages))
	for i, m := range call.Messages {
		if m != nil {
			original[i] = m.Content
		}
	}
	originalBudget := p.materialBudget
	defer func() { p.materialBudget = originalBudget }()
	budget := p.materialBudget
	if budget <= 0 {
		budget = defaultMaterialBudget
	}
	for attempt := 0; attempt < 6; attempt++ {
		p.materialBudget = budget
		for i, m := range call.Messages {
			if m == nil || m.Role != "user" {
				continue
			}
			var body map[string]json.RawMessage
			if StrictJSON([]byte(original[i]), &body) != nil {
				return fail("narrative_stage_invalid")
			}
			if (stage == "write" || stage == "revise") && len(p.plans) > 0 {
				var selected struct {
					ID string `json:"id"`
				}
				if json.Unmarshal(body["selected_plan"], &selected) != nil {
					return fail("narrative_stage_invalid")
				}
				if _, exists := p.plans[selected.ID]; !exists || p.selectedPlanID != "" && p.selectedPlanID != selected.ID {
					return fail("narrative_stage_invalid")
				}
				p.selectedPlanID = selected.ID
			}
			var candidate *Candidate
			if stage == "review" || stage == "repair_review" {
				candidate = &Candidate{}
				if StrictJSON(body["candidate"], candidate) != nil {
					return fail("narrative_stage_invalid")
				}
			} else if stage == "repair_state" || (stage == "extract" || stage == "revise") && p.repairSource != nil {
				var err error
				candidate, err = p.repairCandidate()
				if err != nil {
					return err
				}
			}
			if err := p.replaceStageMaterials(body, stage, candidate); err != nil {
				return err
			}
			if stage == "repair_state" || stage == "extract" && p.repairSource != nil {
				if err := p.reconcileRepairBody(body, *candidate); err != nil {
					return err
				}
			} else if stage == "revise" && p.repairSource != nil {
				// Keep ordinary drafting/plan selection while preserving the
				// exact authority evidence bound to the rejected state.
				rejected, err := p.repairCandidate()
				if err != nil {
					return err
				}
				if err := p.reconcileRepairBody(body, *rejected); err != nil {
					return err
				}
			}
			m.Content = string(narrativeMarshal(body))
		}
		// Keep the original pre-compilation evidence checks. Only reconcile
		// identical authoritative copies after this working set is rebuilt,
		// before duplicate bytes could trigger another shrink or rejection.
		if stage == "review" || stage == "repair_review" {
			if err := p.reconcileReviewEvidence(call); err != nil {
				return err
			}
		}
		if err := p.compileMemoryEvidence(call); err != nil {
			return err
		}
		used := narrativeCallBytes(call)
		if p.stageInputBudget <= 0 || used <= p.stageInputBudget {
			return nil
		}
		budget -= used - p.stageInputBudget + 256
		if budget <= 0 {
			return fail("context_budget_exceeded")
		}
	}
	return fail("context_budget_exceeded")
}
