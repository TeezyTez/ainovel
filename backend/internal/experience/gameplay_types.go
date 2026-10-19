package experience

import "encoding/json"

// Gameplay is public, versioned authority. The nested source-demo structures
// are validated against the closed canonical schema and fixed source rules.
type GameplayState struct {
	SchemaVersion int             `json:"schemaVersion"`
	Game          json.RawMessage `json:"game"`
	Location      string          `json:"location"`
	Inventory     []string        `json:"inventory"`
	Experience    json.RawMessage `json:"experience"`
}
type GameplayUpdate struct {
	SchemaVersion int             `json:"schemaVersion"`
	Game          json.RawMessage `json:"game"`
	Experience    json.RawMessage `json:"experience"`
	Events        []GameplayEvent `json:"events"`
}
type GameplayEvent struct {
	Type     string  `json:"type"`
	Value    string  `json:"value"`
	EntityID *string `json:"entityId"`
	Quote    string  `json:"quote"`
}

// GameplayAction is pinned by Go from a saved definition, never model-authored.
type GameplayAction struct {
	Kind         string           `json:"kind"`
	ActionID     string           `json:"action_id"`
	Result       string           `json:"result"`
	Changes      []GameplayChange `json:"changes"`
	Destination  *string          `json:"destination"`
	Journey      json.RawMessage  `json:"journey"`
	BaseRevision int64            `json:"base_revision"`
}
type GameplayChange struct {
	EntityID string          `json:"entity_id"`
	Kind     string          `json:"kind"`
	Before   json.RawMessage `json:"before"`
	After    json.RawMessage `json:"after"`
}
