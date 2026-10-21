package experience

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

// Original output on a synthetic benchmark, replayed without a model approval.
func TestSYS001OriginalExtractPreservesUnknownCharacterVoice(t *testing.T) {
	raw, err := os.ReadFile("../../../algorithms/tests/fixtures/benchmark-sys001-s04.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Context Context `json:"context"`
		Outputs []struct {
			Stage string `json:"stage"`
			Raw   string `json:"raw"`
			Hash  string `json:"raw_sha256"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	var candidate Candidate
	for _, output := range fixture.Outputs {
		if fmt.Sprintf("%x", sha256.Sum256([]byte(output.Raw))) != output.Hash {
			t.Fatal("replay bytes changed")
		}
		if output.Stage != "extract" {
			continue
		}
		var wrapped struct {
			Result struct {
				CandidateJSON string `json:"candidate_json"`
			} `json:"result"`
		}
		if err := json.Unmarshal([]byte(output.Raw), &wrapped); err != nil {
			t.Fatal(err)
		}
		candidate, err = DecodeCandidate([]byte(wrapped.Result.CandidateJSON))
		if err != nil {
			t.Fatal(err)
		}
	}
	next, err := Apply(fixture.Context, candidate)
	if err != nil {
		t.Fatal(err)
	}
	unknown := 0
	for _, character := range next.Narrative.Characters {
		if character.EntityID == "zhou" || character.EntityID == "shao" {
			if character.Voice != "" {
				t.Fatal("unknown voice invented")
			}
			unknown++
		}
	}
	if unknown != 2 {
		t.Fatal("unknown characters discarded")
	}
}

// Synthetic state fixtures test authority and projection, not literary quality.
func notebookFixture(rev int64) *NarrativeState {
	return &NarrativeState{Version: 1, ThroughRevision: rev, Episodes: []NarrativeEpisode{}, Characters: []NarrativeCharacter{}, Arcs: []NarrativeArc{}, Style: NarrativeStyle{Voice: "克制", Perspective: "第二人称", Pace: "balanced", Detail: "balanced", Avoid: []string{}, PreferenceRefs: []string{}}}
}
func TestNarrativeNotebookAuthorityAndReaderIsolation(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "n", Kind: "person", Name: "守卫", RelatedIDs: []string{}}}
	s.Facts = []Fact{{ID: "f", Kind: "belief", Text: "门外安全", SubjectID: "n", KnownBy: []string{"n"}, SourceRevision: 1}}
	n := notebookFixture(1)
	n.Characters = []NarrativeCharacter{{EntityID: "n", Goals: []string{"守住门"}, Relationships: []NarrativeRelationship{}, Voice: "简短", BeliefFactIDs: []string{"f"}, UpdatedRevision: 1}}
	if err := validateNarrativeState(n, s, 1); err != nil {
		t.Fatal(err)
	}
	s.Narrative = n
	if ReaderState(s).Narrative != nil {
		t.Fatal("private narrative notebook leaked")
	}
	n.Characters[0].EntityID = "absent"
	if validateNarrativeState(n, s, 1) == nil {
		t.Fatal("missing character accepted")
	}
	n.Characters[0].EntityID = "n"
	s.Entities[0].Kind = "place"
	if validateNarrativeState(n, s, 1) == nil {
		t.Fatal("place accepted as NPC")
	}
	s.Entities[0].Kind = "person"
	n.Characters[0].UpdatedRevision = 2
	if validateNarrativeState(n, s, 1) == nil {
		t.Fatal("future revision accepted")
	}
	n.Characters[0].UpdatedRevision = 1
	s.Facts[0].Kind = "fact"
	if validateNarrativeState(n, s, 1) == nil {
		t.Fatal("objective fact accepted as character belief")
	}
}

func TestNarrativeUnknownStyleAndCharacterVoiceFollowSharedContract(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "n", Kind: "person", Name: "silent", RelatedIDs: []string{}}}
	n := notebookFixture(1)
	n.Style.Voice = ""
	n.Style.Perspective = ""
	n.Characters = []NarrativeCharacter{{EntityID: "n", Goals: []string{}, Relationships: []NarrativeRelationship{}, Voice: "", BeliefFactIDs: []string{}, UpdatedRevision: 1}}
	if err := validateNarrativeState(n, s, 1); err != nil { t.Fatal(err) }
	n.Characters[0].Voice = string(make([]byte, 2049))
	if err := validateNarrativeState(n, s, 1); err == nil { t.Fatal("oversized voice accepted") }
}
func TestNarrativeNotebookApplyAndAsk(t *testing.T) {
	var c Candidate
	if err := json.Unmarshal([]byte(`{"title":"title","passage":"正文","story_time":"","outcome":"continues","suggestions":[],"new_facts":[],"new_entities":[],"new_threads":[],"reveal_entity_ids":[],"reveal_thread_ids":[],"reveal_fact_ids":[],"resolve_thread_ids":[],"knowledge_changes":[]}`), &c); err != nil {
		t.Fatal(err)
	}
	ctx := Context{Revision: 0, Mode: "begin", State: EmptyState(), Pipeline: &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}}
	if _, err := Apply(ctx, c); err == nil {
		t.Fatal("v4 accepted missing notebook")
	}
	c.NarrativeUpdate = notebookFixture(1)
	next, err := Apply(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if next.Narrative == nil || next.Narrative.ThroughRevision != 1 {
		t.Fatal("notebook not committed")
	}
	ctx.Mode = "ask"
	ctx.Revision = 1
	ctx.State = next
	if _, err := Apply(ctx, c); err == nil {
		t.Fatal("ask mutated notebook")
	}
}
