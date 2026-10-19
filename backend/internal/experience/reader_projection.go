package experience

// ReaderRecord is structured evidence attached to an append-only formal fact.
// It grants no execution authority: action inputs still use the ordinary act API.
type ReaderRecord struct {
	Kind           string        `json:"kind"`
	EntityID       string        `json:"entity_id"`
	Label          string        `json:"label"`
	TargetID       string        `json:"target_id,omitempty"`
	Value          string        `json:"value,omitempty"`
	Unit           string        `json:"unit,omitempty"`
	Status         string        `json:"status,omitempty"`
	Bearing        string        `json:"bearing,omitempty"`
	DistanceMeters *int64        `json:"distance_meters,omitempty"`
	Passage        string        `json:"passage,omitempty"`
	DueAt          string        `json:"due_at,omitempty"`
	Input          string        `json:"input,omitempty"`
	Columns        []string      `json:"columns,omitempty"`
	Rows           [][]string    `json:"rows,omitempty"`
	Fields         []ReaderField `json:"fields,omitempty"`
}
type ReaderField struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"`
	Value    string   `json:"value,omitempty"`
	Options  []string `json:"options,omitempty"`
	Required bool     `json:"required,omitempty"`
}
type ReaderEvidence struct {
	ReaderRecord
	FactID         string `json:"fact_id"`
	SourceRevision int64  `json:"source_revision"`
	Quote          string `json:"quote"`
}
type ReaderProjection struct {
	Gameplay    *GameplayState   `json:"gameplay,omitempty"`
	Revision    int64            `json:"revision"`
	StoryTime   string           `json:"story_time"`
	Information []Information    `json:"information"`
	Records     []ReaderEvidence `json:"records"`
}

func ProjectReader(state State, revision int64) *ReaderProjection {
	visible := ReaderState(state)
	result := &ReaderProjection{Revision: revision, StoryTime: visible.StoryTime, Information: Project(visible), Gameplay: visible.Gameplay, Records: []ReaderEvidence{}}
	for _, fact := range visible.Facts {
		if fact.Reader != nil {
			result.Records = append(result.Records, ReaderEvidence{ReaderRecord: *fact.Reader, FactID: fact.ID, SourceRevision: fact.SourceRevision, Quote: fact.Text})
		}
	}
	return result
}

func validReaderRecord(record *ReaderRecord, entities map[string]bool) bool {
	if record == nil {
		return true
	}
	if !entities[record.EntityID] || record.TargetID != "" && !entities[record.TargetID] || !textOK(record.Label) {
		return false
	}
	switch record.Kind {
	case "location", "route", "metric", "schedule", "item", "action", "artifact":
	default:
		return false
	}
	if record.DistanceMeters != nil && *record.DistanceMeters < 0 {
		return false
	}
	if record.Bearing != "" {
		switch record.Bearing {
		case "N", "NE", "E", "SE", "S", "SW", "W", "NW":
		default:
			return false
		}
	}
	if record.Passage != "" && record.Passage != "open" && record.Passage != "blocked" && record.Passage != "unknown" {
		return false
	}
	if record.Kind == "route" && (record.TargetID == "" || record.TargetID == record.EntityID) {
		return false
	}
	if record.Kind == "action" && !textOK(record.Input) {
		return false
	}
	if len(record.Columns) > 12 || len(record.Rows) > 100 || len(record.Fields) > 20 {
		return false
	}
	for _, row := range record.Rows {
		if len(row) != len(record.Columns) {
			return false
		}
	}
	seen := map[string]bool{}
	for _, f := range record.Fields {
		if !keyOK(f.ID) || seen[f.ID] || !textOK(f.Label) {
			return false
		}
		seen[f.ID] = true
		switch f.Kind {
		case "text", "number", "select", "checkbox":
		default:
			return false
		}
		if f.Kind == "select" && len(f.Options) == 0 || len(f.Options) > 30 {
			return false
		}
	}
	return true
}
