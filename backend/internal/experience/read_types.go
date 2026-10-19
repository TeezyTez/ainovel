package experience

import (
	"context"
	"encoding/json"
)

// All scope/identity authority is captured by Go; no account is accepted here.
// Contract validation precedes decoding the closed selector union.
type ReadTarget struct {
	Type       string `json:"type"`
	ID         string `json:"id"`
	AtRevision *int64 `json:"at_revision,omitempty"`
}
type ReadSelector struct {
	Kind               string       `json:"kind"`
	Type               string       `json:"type,omitempty"`
	Objects            []ReadTarget `json:"objects,omitempty"`
	Names              []string     `json:"names,omitempty"`
	AtRevision         *int64       `json:"at_revision,omitempty"`
	FromRevision       *int64       `json:"from_revision,omitempty"`
	ToRevision         *int64       `json:"to_revision,omitempty"`
	FactKind           string       `json:"fact_kind,omitempty"`
	Terms              []string     `json:"terms,omitempty"`
	Match              string       `json:"match,omitempty"`
	FromSourceRevision *int64       `json:"from_source_revision,omitempty"`
	ToSourceRevision   *int64       `json:"to_source_revision,omitempty"`
	Cursor             string       `json:"cursor,omitempty"`
}
type ReadRequest struct {
	RequestID     string       `json:"request_id"`
	SourceHandle  string       `json:"source_handle"`
	Selector      ReadSelector `json:"selector"`
	MaxReplyBytes int          `json:"max_reply_bytes"`
}
type ReadFailure struct {
	RequestID string `json:"request_id"`
	ErrorCode string `json:"error_code"`
}

// Reader exists only inside the authenticated accepted operation. Its closure
// carries account/base/fence; it cannot be manufactured from JSON by Rust.
type Reader interface {
	Read(context.Context, ReadRequest) (ReadReply, error)
	RecordModel(context.Context, Context, int, []byte) error
}
type ReadingGenerator interface {
	GenerateWithReads(context.Context, Context, string, Reader) (Candidate, error)
}

func DecodeReadRequest(raw []byte) (ReadRequest, error) {
	var r ReadRequest
	if err := validateContract(raw, "read_request"); err != nil {
		return r, fail("recall_query_incomplete")
	}
	if err := StrictJSON(raw, &r); err != nil {
		return r, fail("recall_query_incomplete")
	}
	return r, nil
}

// CanonicalReceiptJSON preserves integer tokens (never a float round trip),
// sorts object keys through encoding/json, and uses Go's defined string escapes.
func CanonicalReceiptJSON(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return canonicalRawJSON(raw)
}
