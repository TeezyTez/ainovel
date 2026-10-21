package experience

import (
	"encoding/json"
	"math"
	"strings"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	pb "elselife/backend/internal/contract/generated/algorithm/v1"
	"google.golang.org/protobuf/proto"
)

// These bounds are shared with algorithms/src/experience.rs and checked there
// against the actual prompt, schema, bounded brief and final model request.
// Content includes the schema; the legacy reservation retains extra headroom.
const narrativeContentOverheadBytes = 32 << 10
const narrativeSchemaMaxBytes = 9000

// Pipeline aggregates include the single schema, strict-transport expansion and
// fallback framing. Independent review includes context and the frozen candidate;
// draft-planning proposals are not additional review evidence or authorization.
// All carriers retain the same bound, checked against actual Rust stage bytes.
// v4.8's maximum unescaped game extraction measures 35,847 bytes. Reserve
// 36KiB for stages, reducing the generation view by 2KiB at the same model cap.
const narrativePipelineOverheadBytes = 36 << 10
const narrativePipelineSchemaMaxBytes = 20 << 10

func (a *Algorithm) narrativeContextCapacity(authority Context, maximum int) (int, error) {
	overhead, schemaLimit := narrativeContentOverheadBytes, narrativeSchemaMaxBytes
	if authority.Pipeline != nil {
		overhead, schemaLimit = narrativePipelineOverheadBytes, 0
	}
	if !model.CapacityOK(a.ModelContextTokens, a.outputTokens(), a.ModelByteTokenBoundVerified) {
		return 0, fail("context_limit_unknown")
	}
	// Measure dynamic model/coordinate bytes rather than assuming short names.
	// Service root IDs are "experience-" + SHA256 hex; :model:65 is the longest
	// permitted callback suffix. Empty content is covered by the shared bound.
	root := "experience-" + strings.Repeat("0", 64)
	call := &pb.ModelCallRequest{Model: a.ModelName, MaxOutputBytes: 256 << 10, Messages: []*pb.ModelMessage{{Role: "system"}, {Role: "user"}}}
	if authority.Pipeline != nil {
		call.NarrativeStage = "evaluate"
		call.NarrativeActorId = strings.Repeat("x", 128)
	}
	envelope := &pb.Envelope{ProtocolVersion: ProtocolVersion, FrameId: root + ":model:65", CorrelationFrameId: root, ConversationId: authority.ExperienceID, TurnId: authority.Revision + 1, SentAt: math.MaxInt64, Type: "request.model", ContentType: channel.ContentTypeProtobuf, Facts: &pb.RuntimeFacts{DefaultModel: a.ModelName, AllowedModels: []string{a.ModelName}, RemainingModelCalls: 65, ContextTokenLimit: uint32(a.ModelContextTokens), OutputTokenReserve: uint32(a.outputTokens()), ByteTokenBoundVerified: true}}
	// At most 1MiB per frame: 64 bytes covers the payload, schema, two message
	// contents and their nested message length prefixes (each at most 4 bytes).
	transport := proto.Size(envelope) + proto.Size(call) + 64
	framing := 256 + len("system") + len("user") + 2*32
	attachment := 0
	if authority.Mode != "ask" && authority.AuthorWorld != nil {
		raw, err := json.Marshal(map[string]any{"author_world": authority.AuthorWorld})
		if err != nil {
			return 0, err
		}
		attachment = len(raw) + len(authorWorldPromptBoundary) + len("system") + len("user") + 2*32
	}
	available := a.ModelContextTokens - a.outputTokens() - overhead - schemaLimit - transport - framing - attachment
	// The existing carrier guard accounts frame bytes plus message content, so
	// Context can be counted twice there. Respect both guards before compiling.
	inputLimit := a.MaxModelInputBytes
	if inputLimit <= 0 {
		inputLimit = 512 << 10
	}
	carrierAvailable := (inputLimit - 2*overhead - transport - attachment) / 2
	frameAvailable := channel.DefaultMaxPayloadBytes - overhead - transport
	available = min(maximum, available, carrierAvailable, frameAvailable)
	if available <= 0 {
		return 0, fail("context_capacity")
	}
	return available, nil
}
