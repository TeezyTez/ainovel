//go:build integration && codexlive

package experience

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// The initial NAR-010 actor must receive the subjective belief, without a
// narrator's explanation that it is false. This tests actual role projection
// from the authored fixture, not whether a generated scene will be funny.
func TestDeepBenchmarkNAR010BeliefDoesNotDiscloseItsOwnError(t *testing.T) {
	raw, err := os.ReadFile("testdata/deep_benchmark/NAR-010.json")
	must(t, err)
	var fixture deepFixture
	must(t, StrictJSON(raw, &fixture))
	for _, tc := range []struct {
		actor string
		facts []string
	}{
		{"mu", []string{"visible-cups", "mu-goals", "mu-red-belief"}},
		{"qin", []string{"tea-colors", "visible-cups", "qin-goals"}},
		{"he", []string{"visible-cups", "he-goals"}},
	} {
		t.Run(tc.actor, func(t *testing.T) {
			pipeline := newNarrativeRun(Context{Mode: "read", Revision: 1, State: fixture.State})
			projection, err := pipeline.actorProjection(narrativeTrigger{ActorID: tc.actor})
			must(t, err)
			var projected struct {
				Facts []narrativeActorFact `json:"facts"`
			}
			must(t, json.Unmarshal(projection, &projected))
			ids := make([]string, 0, len(projected.Facts))
			for _, fact := range projected.Facts {
				ids = append(ids, fact.ID)
			}
			sort.Strings(ids)
			sort.Strings(tc.facts)
			if !reflect.DeepEqual(ids, tc.facts) {
				t.Fatalf("initial character knowledge differs from the source: %v", ids)
			}
			if tc.actor == "mu" {
				if !strings.Contains(string(projection), "阿穆相信红杯是重要客人的待遇。") {
					t.Fatal("subjective belief was omitted")
				}
				for _, hidden := range []string{"误以为", "无糖茶", "甜茶", "没有领导席"} {
					if strings.Contains(string(projection), hidden) {
						t.Fatalf("actor was told an initially unknown explanation: %s", hidden)
					}
				}
			}
		})
	}
	if strings.Contains(string(narrativeJSON(ReaderState(fixture.State))), "阿穆相信红杯") {
		t.Fatal("private belief leaked to the initial reader")
	}
}
