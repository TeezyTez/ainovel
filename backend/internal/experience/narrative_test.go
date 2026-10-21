package experience

import (
	"encoding/json"
	"testing"
)

func TestMalformedOptionalShapeDoesNotDiscardProse(t *testing.T) {
	c, err := decodeNarrativeCandidate([]byte(`{"title":"新页","passage":"门被推开了。","new_entities":123}`), sampleContext())
	if err != nil || c.Passage != "门被推开了。" || !c.NarrativeOnly {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestNarrativePreservesProseWhenOptionalFactsAreInvalid(t *testing.T) {
	ctx := sampleContext()
	c := sampleCandidate()
	c.Passage = "门被推开了。"
	c.NewFacts = []Fact{{ID: "bad", Text: "尚未归档的细节", SourceRevision: 999}}
	got, state, err := applyNarrative(ctx, c)
	if err != nil || got.Passage != c.Passage || !got.NarrativeOnly {
		t.Fatalf("prose lost: %+v %v", got, err)
	}
	if len(state.Facts) != len(ctx.State.Facts) || len(got.NewFacts) != 0 {
		t.Fatal("invalid metadata committed")
	}
}
func TestNarrativeNeverInventsMissingModelText(t *testing.T) {
	c := sampleCandidate()
	c.Passage = ""
	if _, _, err := applyNarrative(sampleContext(), c); err == nil {
		t.Fatal("empty prose accepted")
	}
}
func TestNarrativeRetainsValidMetadata(t *testing.T) {
	c := sampleCandidate()
	got, _, err := applyNarrative(sampleContext(), c)
	if err != nil || got.NarrativeOnly || got.Passage != c.Passage {
		t.Fatalf("valid candidate changed: %v", err)
	}
}

// These are fixed structural fixtures, not evidence of model narrative quality.
func TestNarrativeKeepsJointAdditionsDespiteInvalidDisclosure(t *testing.T) {
	ctx, c := sampleContext(), sampleCandidate()
	c.NewEntities = []Entity{{ID: "merchant", Name: "商人", Known: true, RelatedIDs: []string{"sale"}}}
	c.NewFacts = []Fact{{ID: "sale", Kind: "fact", Text: "戒指已卖给商人。", SubjectID: "merchant", Known: true, KnownBy: []string{"merchant"}, SourceRevision: 1}}
	c.NewThreads = []Thread{{ID: "recover", Text: "尚需找回戒指。", Known: true, RelatedFactIDs: []string{"sale"}}}
	c.RevealFactIDs = []string{"missing"}
	got, state, err := applyNarrative(ctx, c)
	if err != nil || got.NarrativeOnly || len(state.Facts) != 1 || len(state.Entities) != 1 || len(state.Threads) != 1 || len(got.RevealFactIDs) != 0 {
		t.Fatalf("independent valid continuity lost: %+v %+v %v", got, state, err)
	}
	if _, err = Apply(ctx, got); err != nil {
		t.Fatal("recovered candidate bypassed Apply", err)
	}
}

func TestNarrativeKeepsKnowledgeDespiteInvalidAdditions(t *testing.T) {
	ctx, c := sampleContext(), sampleCandidate()
	ctx.Revision = 2
	ctx.State.Entities = []Entity{{ID: "companion", Name: "同伴", Known: true, RelatedIDs: []string{}}}
	ctx.State.Facts = []Fact{{ID: "ledger", Kind: "secret", Text: "账册在旧屋。", Known: false, KnownBy: []string{}, SourceRevision: 1}}
	c.NewFacts = []Fact{{ID: "broken", Text: "不可信的附加索引", SourceRevision: 999}}
	c.KnowledgeChanges = []KnowledgeChange{{SubjectID: "companion", FactID: "ledger"}}
	got, state, err := applyNarrative(ctx, c)
	if err != nil || got.NarrativeOnly || len(state.Facts) != 1 || len(state.Facts[0].KnownBy) != 1 || state.Facts[0].KnownBy[0] != "companion" || state.Facts[0].Known {
		t.Fatalf("character knowledge lost or disclosed to reader: %+v %+v %v", got, state, err)
	}
	ctx.Mode = "ask"
	got, state, err = applyNarrative(ctx, c)
	if err != nil || !got.NarrativeOnly || len(state.Facts[0].KnownBy) != 0 || state.StoryTime != ctx.State.StoryTime {
		t.Fatal("ask changed state", got, state, err)
	}
}

func TestNarrativeRecoversPresentationWithoutDroppingFacts(t *testing.T) {
	c := sampleCandidate()
	c.Title = ""
	c.Outcome = "ending"
	c.Suggestions = []string{"", "追问商人"}
	c.NewFacts = []Fact{{ID: "sale", Kind: "fact", Text: "戒指已经卖出。", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	got, state, err := applyNarrative(sampleContext(), c)
	if err != nil || got.NarrativeOnly || got.Outcome != "ending" || len(got.Suggestions) != 1 || len(state.Facts) != 1 {
		t.Fatalf("presentation recovery lost valid state: %+v %+v %v", got, state, err)
	}
}

func TestNarrativeDecodesOptionalFieldsIndependently(t *testing.T) {
	c := sampleCandidate()
	c.NewFacts = []Fact{{ID: "sale", Kind: "fact", Text: "戒指已经卖出。", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	raw, _ := json.Marshal(c)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	fields["reveal_fact_ids"] = json.RawMessage(`123`)
	raw, _ = json.Marshal(fields)
	got, err := decodeNarrativeCandidate(raw, sampleContext())
	if err != nil || got.NarrativeOnly || len(got.NewFacts) != 1 || len(got.RevealFactIDs) != 0 {
		t.Fatalf("malformed independent field erased fact: %+v %v", got, err)
	}
}

func TestNarrativeRecoveryRejectsInvalidAdditionDependencies(t *testing.T) {
	for _, defect := range []string{"source", "duplicate", "missing-subject"} {
		t.Run(defect, func(t *testing.T) {
			ctx, c := sampleContext(), sampleCandidate()
			ctx.Revision = 2
			ctx.State.Facts = []Fact{{ID: "existing", Kind: "secret", Text: "已确定的旧事实。", KnownBy: []string{}, SourceRevision: 1}}
			c.NewEntities = []Entity{{ID: "new-person", Name: "新人物", RelatedIDs: []string{"new-fact"}}}
			c.NewFacts = []Fact{{ID: "new-fact", Kind: "fact", Text: "附加索引。", SubjectID: "new-person", KnownBy: []string{}, SourceRevision: 3}}
			switch defect {
			case "source":
				c.NewFacts[0].SourceRevision = 1
			case "duplicate":
				c.NewFacts[0].ID = "existing"
			case "missing-subject":
				c.NewFacts[0].SubjectID = "absent"
			}
			c.KnowledgeChanges = []KnowledgeChange{{SubjectID: "new-person", FactID: "existing"}}
			c.RevealFactIDs = []string{"existing"}
			got, state, err := applyNarrative(ctx, c)
			if err != nil || got.NarrativeOnly || len(state.Entities) != 0 || len(state.Facts) != 1 || len(state.Facts[0].KnownBy) != 0 || !state.Facts[0].Known {
				t.Fatalf("invalid dependency acquired authority or independent disclosure lost: %+v %+v %v", got, state, err)
			}
			if len(got.NewFacts)+len(got.NewEntities)+len(got.KnowledgeChanges) != 0 {
				t.Fatal("unverified metadata retained", got)
			}
		})
	}
}

func TestNarrativeFieldRecoveryKeepsCanonicalRequiredFields(t *testing.T) {
	for _, raw := range []string{
		`{"passage":"正文原字。","new_facts":[{"id":"f","kind":"fact","text":"缺少known不能自动视为false。","subject_id":"","known_by":[],"source_revision":1}]}`,
		`{"passage":"正文原字。","new_facts":[{"id":"f","kind":"fact","text":"未知字段不能获得权威。","subject_id":"","known":true,"known_by":[],"source_revision":1,"override":true}]}`,
	} {
		got, err := decodeNarrativeCandidate([]byte(raw), sampleContext())
		if err != nil || !got.NarrativeOnly || len(got.NewFacts) != 0 || got.Passage != "正文原字。" {
			t.Fatal("malformed fact gained authority", got, err)
		}
	}
	if _, err := decodeNarrativeCandidate([]byte(`{"passage":"原字。","passage":"重复键。"}`), sampleContext()); err == nil {
		t.Fatal("ambiguous repeated JSON key accepted")
	}
}

func TestNarrativeOnlyRevalidationKeepsPriorAuthority(t *testing.T) {
	ctx, c := sampleContext(), sampleCandidate()
	ctx.State.StoryTime = "原来时刻"
	c.NarrativeOnly = true // trusted local fallback, never a model field
	got, state, err := applyNarrative(ctx, c)
	if err != nil || !got.NarrativeOnly || got.StoryTime != "原来时刻" || state.StoryTime != "原来时刻" {
		t.Fatalf("prose-only retry advanced state: %+v %+v %v", got, state, err)
	}
}

func TestNarrativeDecodeDefersOmittedReferenceToFullAuthority(t *testing.T) {
	authority, generation := sampleContext(), sampleContext()
	authority.State.Entities = []Entity{{ID: "merchant", Name: "商人", Known: true, RelatedIDs: []string{}}}
	raw := []byte(`{"title":"成交之后","passage":"戒指卖给了商人。","new_facts":[{"id":"sale","kind":"fact","text":"戒指卖给商人。","subject_id":"merchant","known":true,"known_by":["merchant"],"source_revision":1}],"reveal_fact_ids":123}`)
	candidate, err := decodeNarrativeCandidate(raw, generation)
	if err != nil || len(candidate.NewFacts) != 1 {
		t.Fatal("bounded generation view prematurely erased reference", candidate, err)
	}
	got, state, err := applyNarrative(authority, candidate)
	if err != nil || got.NarrativeOnly || len(state.Facts) != 1 || state.Facts[0].SubjectID != "merchant" {
		t.Fatal("full authority did not validate recovered fact", got, state, err)
	}
}

func TestNarrativeMissingOrMalformedClockKeepsPriorTime(t *testing.T) {
	for _, clock := range []string{"", `,"story_time":123`} {
		ctx := sampleContext()
		ctx.State.StoryTime = "第二日午后"
		raw := []byte(`{"title":"成交之后","passage":"戒指已经卖出。","new_facts":[{"id":"sale","kind":"fact","text":"戒指已经卖出。","subject_id":"","known":true,"known_by":[],"source_revision":1}],"reveal_fact_ids":123` + clock + `}`)
		candidate, err := decodeNarrativeCandidate(raw, ctx)
		if err != nil {
			t.Fatal(err)
		}
		got, state, err := applyNarrative(ctx, candidate)
		if err != nil || len(state.Facts) != 1 || got.StoryTime != "第二日午后" || state.StoryTime != "第二日午后" {
			t.Fatal("recovered metadata erased prior clock", got, state, err)
		}
	}
}

func TestNarrativeKeepsFactWhenUnrelatedThreadIsInvalid(t *testing.T) {
	ctx, c := sampleContext(), sampleCandidate()
	ctx.State.Entities = []Entity{{ID: "merchant", Name: "商人", Known: true, RelatedIDs: []string{}}}
	c.NewFacts = []Fact{{ID: "sale", Kind: "fact", Text: "戒指已经卖给商人。", SubjectID: "merchant", Known: true, KnownBy: []string{"merchant"}, SourceRevision: 1}}
	c.NewThreads = []Thread{{ID: "bad-thread", Text: "另一个悬念。", Known: true, RelatedFactIDs: []string{"missing"}}}
	got, state, err := applyNarrative(ctx, c)
	if err != nil || got.NarrativeOnly || len(state.Facts) != 1 || state.Facts[0].ID != "sale" || len(state.Threads) != 0 {
		t.Fatal("unrelated invalid thread erased sale", got, state, err)
	}
}
