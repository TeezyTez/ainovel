// Package experience owns ElseLife formal history, operations and known projections.
// Algorithms propose candidates; only a fenced PostgreSQL transaction can commit them.
package experience

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

type Fact struct {
	Reader         *ReaderRecord `json:"reader,omitempty"`
	ID             string        `json:"id"`
	Kind           string        `json:"kind"`
	Text           string        `json:"text"`
	SubjectID      string        `json:"subject_id"`
	Known          bool          `json:"known"`
	KnownBy        []string      `json:"known_by"`
	SourceRevision int64         `json:"source_revision"`
}
type Entity struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Known       bool     `json:"known"`
	RelatedIDs  []string `json:"related_ids"`
}
type Thread struct {
	ID             string   `json:"id"`
	Text           string   `json:"text"`
	Known          bool     `json:"known"`
	RelatedFactIDs []string `json:"related_fact_ids"`
	// ResolvedAtRevision is Go-written formal revision at which this stable
	// thread identity was closed. Nil/null means still open. Resolution keeps
	// the identity and its relations; the ID cannot be rebound to a new topic.
	ResolvedAtRevision *int64 `json:"resolved_at_revision"`
}
type State struct {
	Gameplay  *GameplayState `json:"gameplay,omitempty"`
	StoryTime string         `json:"story_time"`
	Facts     []Fact         `json:"facts"`
	Entities  []Entity       `json:"entities"`
	Threads   []Thread       `json:"threads"`
}
type Preference struct {
	Dimension string `json:"dimension"`
	Value     string `json:"value"`
	Source    string `json:"source"`
	Evidence  string `json:"evidence"`
}
type PreferenceView struct {
	Preference
	Confirmed bool      `json:"confirmed"`
	UpdatedAt time.Time `json:"updated_at"`
}
type HistoryPage struct {
	Revision int64  `json:"revision"`
	Mode     string `json:"mode"`
	Input    string `json:"input"`
	Text     string `json:"text"`
}
type StateCounts struct {
	Facts    int64 `json:"facts"`
	Entities int64 `json:"entities"`
	Threads  int64 `json:"threads"`
}

// StateCoverage is the backend-computed honesty object about which exact
// current-authority objects were materialized into this generation input.
// omitted != undetermined: a deferred object still binds later prose.
type StateCoverage struct {
	Policy             string       `json:"policy"`
	RecentFromRevision int64        `json:"recent_from_revision"`
	Total              StateCounts  `json:"total"`
	Omitted            StateCounts  `json:"omitted"`
	OmittedReaderKnown *StateCounts `json:"omitted_reader_known,omitempty"`
	Complete           bool         `json:"complete"`
	SourceHandle       string       `json:"source_handle"`
	Audience           string       `json:"audience"`
}

// ReadBudget is Go-declared, finite, within-operation external-read budget.
// It never authorizes extra model calls; those are bounded separately.
type ReadBudget struct {
	MaxReads           int `json:"max_reads"`
	MaxReplyBytes      int `json:"max_reply_bytes"`
	MaxTotalReplyBytes int `json:"max_total_reply_bytes"`
}

// ReadReply is a backend-issued exact result at one immutable operation pin.
type ReadReply struct {
	RequestID    string        `json:"request_id"`
	SourceHandle string        `json:"source_handle"`
	ExperienceID string        `json:"experience_id"`
	BranchID     string        `json:"branch_id"`
	BaseRevision int64         `json:"base_revision"`
	Audience     string        `json:"audience"`
	Objects      []ReadObject  `json:"objects"`
	Pages        []HistoryPage `json:"pages"`
	Complete     bool          `json:"complete"`
	NextCursor   *string       `json:"next_cursor"`
	Receipt      ReadReceipt   `json:"receipt"`
}
type ReadObject struct {
	Type         string          `json:"type"`
	AsOfRevision int64           `json:"as_of_revision"`
	Body         json.RawMessage `json:"body"`
}
type ReadReceipt struct {
	QuerySHA256 string `json:"query_sha256"`
	BodySHA256  string `json:"body_sha256"`
}

type Context struct {
	GameplayReplay  *GameplayReplay  `json:"-"`
	GameplayRuntime *ArtifactRuntime `json:"-"`
	GameplayContext context.Context  `json:"-"`
	GameplayAction  *GameplayAction  `json:"gameplay_action,omitempty"`
	AuthorWorld     *WorldDraft      `json:"-"` // Go-only private prompt attachment, never ordinary DTO/contract JSON.
	Version         int              `json:"version"`
	ExperienceID    string           `json:"experience_id"`
	BranchID        string           `json:"branch_id"`
	Revision        int64            `json:"revision"`
	Mode            string           `json:"mode"`
	Input           string           `json:"input"`
	Seed            string           `json:"seed"`
	State           State            `json:"state"`
	Preferences     []Preference     `json:"preferences"`
	History         []HistoryPage    `json:"history"`
	HistoryComplete bool             `json:"history_complete"`
	StateCoverage   StateCoverage    `json:"state_coverage"`
	Recalls         []ReadReply      `json:"recalls"`
	ReadBudget      ReadBudget       `json:"read_budget"`
}
type KnowledgeChange struct {
	SubjectID string `json:"subject_id"`
	FactID    string `json:"fact_id"`
}
type Candidate struct {
    NarrativeOnly bool `json:"-"` // local commit mode; never trusted from a model or client
	GameplayUpdate   *GameplayUpdate   `json:"gameplay_update,omitempty"`
	Title            string            `json:"title"`
	Passage          string            `json:"passage"`
	StoryTime        string            `json:"story_time"`
	Outcome          string            `json:"outcome"`
	Suggestions      []string          `json:"suggestions"`
	NewFacts         []Fact            `json:"new_facts"`
	NewEntities      []Entity          `json:"new_entities"`
	NewThreads       []Thread          `json:"new_threads"`
	RevealEntityIDs  []string          `json:"reveal_entity_ids"`
	RevealThreadIDs  []string          `json:"reveal_thread_ids"`
	RevealFactIDs    []string          `json:"reveal_fact_ids"`
	ResolveThreadIDs []string          `json:"resolve_thread_ids"`
	KnowledgeChanges []KnowledgeChange `json:"knowledge_changes"`
}
type Page struct {
	InteractionSnapshot      *ArtifactSnapshot `json:"interaction_snapshot,omitempty"`
	PreviousArtifactSnapshot *ArtifactSnapshot `json:"previous_artifact_snapshot,omitempty"`
	GameplayReceipt          *GameplayReceipt  `json:"gameplay_receipt,omitempty"`
	Reader                   *ReaderProjection `json:"reader,omitempty"`
	HistoryPage
	StoryTime   string    `json:"story_time"`
	CreatedAt   time.Time `json:"created_at"`
	Suggestions []string  `json:"suggestions"`
	Outcome     string    `json:"outcome"`
}
type Branch struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Revision       int64   `json:"revision"`
	ParentBranchID *string `json:"parent_branch_id,omitempty"`
	ParentRevision *int64  `json:"parent_revision,omitempty"`
}
type Operation struct {
	RequestID         string  `json:"request_id"`
	ExperienceID      string  `json:"experience_id"`
	BranchID          string  `json:"branch_id"`
	Status            string  `json:"status"`
	BaseRevision      int64   `json:"base_revision"`
	CommittedRevision *int64  `json:"committed_revision,omitempty"`
	ErrorCode         *string `json:"error_code,omitempty"`
}
type Information struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Name       string   `json:"name"`
	Text       string   `json:"text"`
	RelatedIDs []string `json:"related_ids"`
}
type Summary struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Seed           string    `json:"seed"`
	ActiveBranchID string    `json:"active_branch_id"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type View struct {
	Gameplay       *GameplayState    `json:"gameplay,omitempty"`
	Reader         *ReaderProjection `json:"reader,omitempty"`
	UpdatedAt      time.Time         `json:"updated_at"`
	ID             string            `json:"id"`
	Title          string            `json:"title"`
	Seed           string            `json:"seed"`
	ActiveBranchID string            `json:"active_branch_id"`
	Branches       []Branch          `json:"branches"`
	BranchID       string            `json:"branch_id"`
	Revision       int64             `json:"revision"`
	Pages          []Page            `json:"pages"`
	Information    []Information     `json:"information"`
	Operation      *Operation        `json:"operation,omitempty"`
}
type CreateRequest struct {
	AuthorWorld  *WorldDraft         `json:"author_world,omitempty"`
	WorldVersion *WorldVersionChange `json:"world_version,omitempty"`
	RequestID    string              `json:"request_id"`
	Seed         string              `json:"seed"`
}
type AdvanceRequest struct {
	RequestID        string `json:"request_id"`
	BranchID         string `json:"branch_id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Mode             string `json:"mode"`
	Input            string `json:"input"`
}
type Edit struct {
	FactID string `json:"fact_id"`
	Text   string `json:"text"`
}
type ForkRequest struct {
	AuthorWorld      *WorldDraft         `json:"author_world,omitempty"`
	ExpectedRevision *int64              `json:"expected_revision,omitempty"`
	Polish           *PolishChange       `json:"polish,omitempty"`
	WorldVersion     *WorldVersionChange `json:"world_version,omitempty"`
	Repair           *RepairChange       `json:"repair,omitempty"`
	RequestID        string              `json:"request_id"`
	FromBranchID     string              `json:"from_branch_id"`
	FromRevision     int64               `json:"from_revision"`
	Name             string              `json:"name"`
	Edit             *Edit               `json:"edit,omitempty"`
}

type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }
func fail(code string) error   { return &Error{Code: code} }
func EmptyState() State        { return State{Facts: []Fact{}, Entities: []Entity{}, Threads: []Thread{}} }
func StrictJSON(raw []byte, dst any) error {
	if !utf8.Valid(raw) || !uniqueJSON(raw) {
		return fail("invalid_json")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return fail("invalid_json")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fail("invalid_json")
	}
	return nil
}
func uniqueJSON(raw []byte) bool {
	d := json.NewDecoder(bytes.NewReader(raw))
	var value func() error
	value = func() error {
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		if delim == '{' {
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				s, ok := key.(string)
				if !ok || seen[s] {
					return fail("invalid_json")
				}
				seen[s] = true
				if err = value(); err != nil {
					return err
				}
			}
		} else if delim == '[' {
			for d.More() {
				if err = value(); err != nil {
					return err
				}
			}
		} else {
			return fail("invalid_json")
		}
		_, err = d.Token()
		return err
	}
	if value() != nil {
		return false
	}
	_, err := d.Token()
	return err == io.EOF
}

func RequiredJSON(raw []byte, fields ...string) error {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return fail("invalid_json")
	}
	for _, key := range fields {
		v, ok := object[key]
		if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return fail("invalid_json")
		}
	}
	return nil
}
func textOK(s string) bool { return utf8.ValidString(s) && strings.TrimSpace(s) != "" }
func keyOK(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '.') {
			return false
		}
	}
	return true
}

// Apply is append-only for facts and entities. Revealing changes knowledge, never text.
// Ask can explain but cannot advance time or mutate any world relation.
func Apply(ctx Context, c Candidate) (State, error) {
	if !textOK(c.Title) || !textOK(c.Passage) || !utf8.ValidString(c.StoryTime) || c.Suggestions == nil || c.NewFacts == nil || c.NewEntities == nil || c.NewThreads == nil || c.RevealEntityIDs == nil || c.RevealThreadIDs == nil || c.RevealFactIDs == nil || c.ResolveThreadIDs == nil || c.KnowledgeChanges == nil {
		return State{}, fail("invalid_candidate")
	}
	switch c.Outcome {
	case "continues", "awaits_player", "ending":
	default:
		return State{}, fail("invalid_candidate")
	}
	for _, s := range c.Suggestions {
		if !textOK(s) {
			return State{}, fail("invalid_candidate")
		}
	}
	if ctx.Mode == "ask" && (c.GameplayUpdate != nil || c.StoryTime != ctx.State.StoryTime || len(c.NewFacts)+len(c.NewEntities)+len(c.NewThreads)+len(c.RevealEntityIDs)+len(c.RevealThreadIDs)+len(c.RevealFactIDs)+len(c.ResolveThreadIDs)+len(c.KnowledgeChanges) > 0) {
		return State{}, fail("ask_mutation")
	}
	raw, _ := json.Marshal(ctx.State)
	var state State
	if err := json.Unmarshal(raw, &state); err != nil {
		return State{}, err
	}
	all := map[string]bool{}
	facts := map[string]int{}
	entities := map[string]bool{}
	threads := map[string]bool{}
	for i, f := range state.Facts {
		all[f.ID] = true
		facts[f.ID] = i
	}
	for _, e := range state.Entities {
		all[e.ID] = true
		entities[e.ID] = true
	}
	for _, t := range state.Threads {
		all[t.ID] = true
		threads[t.ID] = true
	}
	add := func(id string) bool {
		if !keyOK(id) || all[id] {
			return false
		}
		all[id] = true
		return true
	}
	for _, e := range c.NewEntities {
		if !add(e.ID) || !textOK(e.Name) || !utf8.ValidString(e.Kind) || !utf8.ValidString(e.Description) || e.RelatedIDs == nil {
			return State{}, fail("invalid_candidate")
		}
		entities[e.ID] = true
	}
	for _, f := range c.NewFacts {
		if !add(f.ID) || !textOK(f.Text) || f.KnownBy == nil || f.SourceRevision != ctx.Revision+1 {
			return State{}, fail("invalid_candidate")
		}
		switch f.Kind {
		case "fact", "rule", "secret", "statement", "belief":
		default:
			return State{}, fail("invalid_candidate")
		}
		if f.SubjectID != "" && !entities[f.SubjectID] {
			return State{}, fail("invalid_candidate")
		}
		if (f.Kind == "statement" || f.Kind == "belief") && f.SubjectID == "" {
			return State{}, fail("invalid_candidate")
		}
		seenBy := map[string]bool{}
		for _, id := range f.KnownBy {
			if !entities[id] || seenBy[id] {
				return State{}, fail("invalid_candidate")
			}
			seenBy[id] = true
		}
		facts[f.ID] = len(state.Facts)
		state.Facts = append(state.Facts, f)
	}
	for _, t := range c.NewThreads {
		if !add(t.ID) || !textOK(t.Text) || t.RelatedFactIDs == nil || t.ResolvedAtRevision != nil {
			return State{}, fail("invalid_candidate")
		}
		for _, id := range t.RelatedFactIDs {
			if _, ok := facts[id]; !ok {
				return State{}, fail("invalid_candidate")
			}
		}
		threads[t.ID] = true
		state.Threads = append(state.Threads, t)
	}
	for _, e := range c.NewEntities {
		for _, id := range e.RelatedIDs {
			if !all[id] {
				return State{}, fail("invalid_candidate")
			}
		}
		state.Entities = append(state.Entities, e)
	}
	seen := map[string]bool{}
	for _, id := range c.RevealFactIDs {
		i, ok := facts[id]
		if !ok || seen[id] {
			return State{}, fail("invalid_candidate")
		}
		seen[id] = true
		state.Facts[i].Known = true
	}
	seen = map[string]bool{}
	for _, id := range c.RevealEntityIDs {
		if seen[id] {
			return State{}, fail("invalid_candidate")
		}
		seen[id] = true
		i := -1
		for n, e := range ctx.State.Entities {
			if e.ID == id {
				i = n
				break
			}
		}
		if i < 0 {
			return State{}, fail("invalid_candidate")
		}
		state.Entities[i].Known = true
	}
	seen = map[string]bool{}
	for _, id := range c.RevealThreadIDs {
		if seen[id] {
			return State{}, fail("invalid_candidate")
		}
		seen[id] = true
		i := -1
		for n, v := range ctx.State.Threads {
			if v.ID == id {
				i = n
				break
			}
		}
		if i < 0 {
			return State{}, fail("invalid_candidate")
		}
		state.Threads[i].Known = true
	}
	seen = map[string]bool{}
	for _, id := range c.ResolveThreadIDs {
		if !threads[id] || seen[id] {
			return State{}, fail("invalid_candidate")
		}
		seen[id] = true
	}
	// Resolution is a formal transition, not deletion: keep the stable
	// identity and its relations so later references still resolve, and stamp
	// the next formal revision as the closure time. A re-used ID collides; an
	// already-resolved thread cannot be resolved again.
	for i := range state.Threads {
		if !seen[state.Threads[i].ID] {
			continue
		}
		if state.Threads[i].ResolvedAtRevision != nil {
			return State{}, fail("invalid_candidate")
		}
		resolved := ctx.Revision + 1
		state.Threads[i].ResolvedAtRevision = &resolved
	}
	for _, change := range c.KnowledgeChanges {
		i, ok := facts[change.FactID]
		if !ok || !entities[change.SubjectID] {
			return State{}, fail("invalid_candidate")
		}
		for _, id := range state.Facts[i].KnownBy {
			if id == change.SubjectID {
				return State{}, fail("invalid_candidate")
			}
		}
		state.Facts[i].KnownBy = append(state.Facts[i].KnownBy, change.SubjectID)
	}
	for _, f := range c.NewFacts {
		if !validReaderRecord(f.Reader, entities) {
			return State{}, fail("invalid_candidate")
		}
	}
	state.StoryTime = c.StoryTime
	gameplay, err := applyGameplay(ctx, c)
	if err != nil {
		return State{}, err
	}
	state.Gameplay = gameplay
	return state, nil
}

func Project(s State) []Information {
	known := map[string]bool{}
	for _, f := range s.Facts {
		if f.Known {
			known[f.ID] = true
		}
	}
	for _, e := range s.Entities {
		if e.Known {
			known[e.ID] = true
		}
	}
	for _, t := range s.Threads {
		if t.Known {
			known[t.ID] = true
		}
	}
	refs := func(ids []string) []string {
		r := []string{}
		for _, id := range ids {
			if known[id] {
				r = append(r, id)
			}
		}
		return r
	}
	out := []Information{}
	for _, f := range s.Facts {
		if f.Known {
			out = append(out, Information{ID: "fact:" + f.ID, Kind: f.Kind, Name: "", Text: f.Text, RelatedIDs: refs([]string{f.SubjectID})})
		}
	}
	for _, e := range s.Entities {
		if e.Known {
			out = append(out, Information{ID: "entity:" + e.ID, Kind: e.Kind, Name: e.Name, Text: e.Description, RelatedIDs: refs(e.RelatedIDs)})
		}
	}
	for _, t := range s.Threads {
		if t.Known {
			out = append(out, Information{ID: "thread:" + t.ID, Kind: "thread", Name: "", Text: t.Text, RelatedIDs: refs(t.RelatedFactIDs)})
		}
	}
	prefix := map[string]string{}
	for _, f := range s.Facts {
		prefix[f.ID] = "fact:"
	}
	for _, e := range s.Entities {
		prefix[e.ID] = "entity:"
	}
	for _, t := range s.Threads {
		prefix[t.ID] = "thread:"
	}
	for i := range out {
		for j, id := range out[i].RelatedIDs {
			out[i].RelatedIDs[j] = prefix[id] + id
		}
	}
	return out
}
