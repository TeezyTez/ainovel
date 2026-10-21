package experience

import (
	"strings"
	"testing"
)

// SYS-007/SYS-016 boundary regression only: a synthetic director-authored
// notebook must never grant an actor knowledge absent from known_by facts.
func TestBenchmarkSYS007ActorNotebookCannotGrantUnknownKnowledge(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "song", Kind: "person", Name: "宋", RelatedIDs: []string{}}, {ID: "xu", Kind: "person", Name: "许", RelatedIDs: []string{}}}
	s.Facts = []Fact{
		{ID: "old-location", Kind: "belief", Text: "宋仍相信包裹在甲仓", SubjectID: "song", KnownBy: []string{"song"}, SourceRevision: 1},
		{ID: "own-goal", Kind: "fact", Text: "宋想在今日取到自己的包裹", SubjectID: "song", KnownBy: []string{"song"}, SourceRevision: 1},
		{ID: "new-location", Kind: "secret", Text: "包裹已经移到乙仓", KnownBy: []string{"xu"}, SourceRevision: 1},
	}
	s.Narrative = notebookFixture(1)
	s.Narrative.Characters = []NarrativeCharacter{{EntityID: "song", Goals: []string{"去乙仓获取包裹"}, Voice: "已经知道乙仓的位置", Relationships: []NarrativeRelationship{{EntityID: "xu", Stance: "许秘密知道包裹在乙仓", FactIDs: []string{}}}, BeliefFactIDs: []string{"old-location"}, UpdatedRevision: 1}}
	if err := validateNarrativeState(s.Narrative, s, 1); err != nil {
		t.Fatalf("fixture must be persistable before testing its audience boundary: %v", err)
	}
	p := newNarrativeRun(Context{Mode: "read", Revision: 1, State: s})
	raw, err := p.actorProjection(narrativeTrigger{ActorID: "song", FactIDs: []string{"old-location"}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "乙仓") || strings.Contains(string(raw), "new-location") {
		t.Fatalf("SYS-007-H1 unknown location reached actor through global notebook: %s", raw)
	}
	for _, visible := range []string{"宋仍相信包裹在甲仓", "宋想在今日取到自己的包裹"} {
		if !strings.Contains(string(raw), visible) {
			t.Fatalf("positive control: authorized actor evidence missing: %s", visible)
		}
	}
}

// SYS-001 H3 / SYS-007: a player privately learning an existing fact does not
// tell another character that the player learned it. Actor input must therefore
// be invariant under the reader-only Known bit, absent a propagation event.
func TestBenchmarkSYS001ReaderKnowledgeDoesNotInformActorAboutReader(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "archivist", Kind: "person", Name: "黎桑", RelatedIDs: []string{}}}
	s.Facts = []Fact{{ID: "payment", Kind: "secret", Text: "运费已经付清", Known: false, KnownBy: []string{"archivist"}, SourceRevision: 1}}
	p := newNarrativeRun(Context{Mode: "read", Revision: 1, State: s})
	before, err := p.actorProjection(narrativeTrigger{ActorID: "archivist", FactIDs: []string{"payment"}})
	if err != nil {
		t.Fatal(err)
	}
	p.context.State.Facts[0].Known = true
	after, err := p.actorProjection(narrativeTrigger{ActorID: "archivist", FactIDs: []string{"payment"}})
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("SYS-001-H3 reader's private discovery altered uninformed actor input: before=%s after=%s", before, after)
	}
}

func TestBenchmarkSYS001PrivateActorLearningDoesNotInformReader(t *testing.T) {
	s := EmptyState()
	s.Entities = []Entity{{ID: "guard", Kind: "person", Name: "邵舟", Known: true, RelatedIDs: []string{}}}
	s.Facts = []Fact{{ID: "payment", Kind: "fact", Text: "运费已经付清", Known: true, KnownBy: []string{}, SourceRevision: 1}}
	before := narrativeJSON(ReaderState(s))
	s.Facts[0].KnownBy = []string{"guard"}
	after := narrativeJSON(ReaderState(s))
	if string(before) != string(after) {
		t.Fatalf("SYS-001-H3 private actor learning leaked into reader/ask evidence: before=%s after=%s", before, after)
	}
}
