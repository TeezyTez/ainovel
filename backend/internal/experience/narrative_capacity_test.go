package experience

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"elselife/backend/internal/sqlc/pgq"
)

// Fixed history measures context accounting, not generated text quality.
func longNarrativeCapacityContext() Context {
	c := sampleContext()
	c.Mode, c.Revision = "read", 6
	for revision := int64(1); revision <= c.Revision; revision++ {
		c.History = append(c.History, HistoryPage{Revision: revision, Mode: "read", Text: strings.Repeat("old history ", 770)})
	}
	return c
}

func TestNarrativeCapacityFailsClosedWhenOverheadConsumesWindow(t *testing.T) {
	a := &Algorithm{ModelContextTokens: 8192, MaxOutputTokens: 4096, ModelByteTokenBoundVerified: true}
	s := &Service{ProseFirst: true, Generator: a}
	if _, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{}, sampleContext()); err == nil || err.Error() != "context_capacity" {
		t.Fatal("tiny model context silently regained the full service byte budget", err)
	}
}

func TestNarrativeObjectSchemaReservationPreservesAllCarrierCapacity(t *testing.T) {
	a := &Algorithm{ModelContextTokens: 131072, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	c := sampleContext()
	c.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}
	ordinary, err := a.narrativeContextCapacity(c, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		game   string
		action string
	}{
		{"experience_only", "null", ""},
		{"null_whitespace", " null ", "dynamic"},
		{"active_game", "{}", ""},
		{"journey", "null", "journey"},
		{"game_action", "null", "game"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := c
			copy.State.Gameplay = &GameplayState{Game: json.RawMessage(tc.game)}
			if tc.action != "" {
				copy.GameplayAction = &GameplayAction{Kind: tc.action}
			}
			capacity, err := a.narrativeContextCapacity(copy, 1<<20)
			expected := ordinary
			if err != nil || capacity != expected {
				t.Fatalf("carrier schema reservation drift: %d expected %d err %v", capacity, expected, err)
			}
		})
	}
}

func TestNarrativeCapacityAccountsForAuthorAttachmentOnlyWhenSent(t *testing.T) {
	a := &Algorithm{ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	s := &Service{ProseFirst: true, Generator: a}
	c := sampleContext()
	world := completeWorldDraft()
	world.Opening = strings.Repeat("开", 12000)
	c.AuthorWorld = &world
	if _, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{}, c); err == nil {
		t.Fatal("large author attachment omitted from input budget")
	}
	c.Mode = "ask"
	view, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{}, c)
	if err != nil || view.AuthorWorld != nil {
		t.Fatal("ask reserved or exposed a private attachment that is never sent", err)
	}
}

func TestNarrativeCapacityRespectsWholeCarrierInputLimit(t *testing.T) {
	a := &Algorithm{ModelContextTokens: 131072, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true, MaxModelInputBytes: 65536}
	s := &Service{ProseFirst: true, Generator: a}
	if _, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{}, sampleContext()); err == nil {
		t.Fatal("smaller whole-carrier limit was ignored")
	}
}

func pipelineCapacityContext(t *testing.T) Context {
	t.Helper()
	c := longNarrativeCapacityContext()
	c.Pipeline = &NarrativePipeline{Version: 1, MaxActors: 2, MaxRepairs: 1}
	c.History[len(c.History)-1].Text = strings.Repeat("latest page ", 80)
	c.State.Narrative = notebookFixture(c.Revision)
	for i := 0; i < 6; i++ {
		c.State.Narrative.Episodes = append(c.State.Narrative.Episodes, NarrativeEpisode{ID: fmt.Sprintf("episode_%d", i), Summary: strings.Repeat("s", 1800), FromRevision: 1, ToRevision: c.Revision, FactIDs: []string{}})
	}
	raw, _ := json.Marshal(c.State.Narrative)
	c.State.Narrative.Episodes[0].Summary += strings.Repeat("s", (12<<10)-len(raw))
	if err := validateNarrativeState(c.State.Narrative, c.State, c.Revision); err != nil {
		t.Fatal("capacity fixture must be a valid full-size notebook", err)
	}
	return c
}

func TestNarrativePipelineCapacityKeepsNotebookInAuthorityAndLatestShortPage(t *testing.T) {
	a := &Algorithm{ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	s := &Service{NarrativeEngine: true, Generator: a}
	c := pipelineCapacityContext(t)
	view, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{BaseRevision: c.Revision}, c)
	if err != nil {
		t.Fatal(err)
	}
	if view.HistoryComplete || len(view.History) >= len(c.History) || view.History[len(view.History)-1].Text != c.History[len(c.History)-1].Text {
		t.Fatal("v4 failed to trim only whole old pages")
	}
	if view.State.Narrative != nil || view.AuthorityState == nil {
		t.Fatal("the entire private index was copied into the entry prompt or lost from authority")
	}
	raw, _ := json.Marshal(view.AuthorityState.Narrative)
	if len(raw) != 12<<10 {
		t.Fatal("source notebook was discarded or truncated", len(raw))
	}
	a.ModelContextTokens = 40960
	if _, err := s.buildGeneration(context.Background(), pgq.ExperienceOperation{BaseRevision: c.Revision}, c); err == nil || err.Error() != "context_capacity" {
		t.Fatal("v4 silently squeezed an unsupported model context", err)
	}
}
