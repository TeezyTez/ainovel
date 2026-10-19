package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"strings"
	"time"

	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/sqlc/pgq"
)

//go:embed artifact_prompt.txt
var sourceArtifactPrompt string

type ArtifactRuntime struct{ NodePath, ValidatorPath, CompilerPath string }

// The worker runs only fixed source validators, never a model-supplied program.
func (r *ArtifactRuntime) run(ctx context.Context, value any) (json.RawMessage, error) {
	if r == nil || r.NodePath == "" || r.ValidatorPath == "" {
		return nil, fail("artifact_unavailable")
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > 4<<20 {
		return nil, fail("invalid_artifact")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.NodePath, "--max-old-space-size=96", r.ValidatorPath)
	cmd.Stdin = bytes.NewReader(raw)
	output := limitedArtifactBuffer{limit: 4 << 20}
	cmd.Stdout = &output
	cmd.Stderr = io.Discard
	if cmd.Run() != nil || output.over || !json.Valid(output.Bytes()) {
		return nil, fail("invalid_artifact")
	}
	return append(json.RawMessage{}, output.Bytes()...), nil
}

type limitedArtifactBuffer struct {
	bytes.Buffer
	over  bool
	limit int
}

func (b *limitedArtifactBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		b.over = true
		return 0, errors.New("artifact output limit")
	}
	return b.Buffer.Write(p)
}

type ArtifactPrepareRequest struct {
	InputRouting     bool   `json:"input_routing,omitempty"`
	RequestID        string `json:"request_id"`
	BranchID         string `json:"branch_id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Intent           string `json:"intent,omitempty"`
	Retry            bool   `json:"retry,omitempty"`
}
type ArtifactStateRequest struct {
	RequestID             string          `json:"request_id"`
	BranchID              string          `json:"branch_id"`
	ExpectedRevision      int64           `json:"expected_revision"`
	RevisionID            string          `json:"revision_id"`
	ExpectedStateRevision int64           `json:"expected_state_revision"`
	State                 json.RawMessage `json:"state"`
}
type ArtifactRestoreRequest struct {
	RequestID             string `json:"request_id"`
	BranchID              string `json:"branch_id"`
	ExpectedRevision      int64  `json:"expected_revision"`
	RevisionID            string `json:"revision_id"`
	ExpectedHead          string `json:"expected_head"`
	ExpectedStateRevision int64  `json:"expected_state_revision"`
}
type ArtifactDocument struct {
	ArtifactID    string          `json:"artifact_id"`
	RevisionID    string          `json:"revision_id"`
	BaseRevision  int64           `json:"base_revision"`
	StateRevision int64           `json:"state_revision"`
	State         json.RawMessage `json:"state"`
	Payload       json.RawMessage `json:"payload"`
	Digest        string          `json:"digest"`
	CreatedAt     time.Time       `json:"created_at"`
	Stale         bool            `json:"stale"`
}
type ArtifactMetadata struct {
	RevisionID   string    `json:"revision_id"`
	BaseRevision int64     `json:"base_revision"`
	CreatedAt    time.Time `json:"created_at"`
	Title        string    `json:"title"`
}
type ArtifactResponse struct {
	InputDecision  *ArtifactInputDecision  `json:"input_decision,omitempty"`
	IntentDecision *ArtifactIntentDecision `json:"intent_decision,omitempty"`
	RoutingScope   *ArtifactRoutingScope   `json:"routing_scope,omitempty"`
	Artifact       *ArtifactDocument       `json:"artifact"`
	Revisions      []ArtifactMetadata      `json:"revisions"`
}

func artifactDigest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func artifactResponse(ctx context.Context, q *pgq.Queries, a, e, b, id, revision string, current int64) (ArtifactResponse, error) {
	out := ArtifactResponse{Revisions: []ArtifactMetadata{}}
	head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: b})
	if errors.Is(err, sql.ErrNoRows) {
		if id != "" {
			return out, sql.ErrNoRows
		}
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if id != "" && id != head.ArtifactID {
		return out, sql.ErrNoRows
	}
	if revision == "" {
		revision = head.RevisionID
	}
	rows, err := q.ExperienceArtifactVersions(ctx, pgq.ExperienceArtifactVersionsParams{AccountID: a, ExperienceID: e, BranchID: b})
	if err != nil {
		return out, err
	}
	for _, row := range rows {
		var p struct {
			Definition *struct {
				Title string `json:"title"`
			} `json:"definition"`
		}
		_ = json.Unmarshal(row.Payload, &p)
		title := "相关资料"
		if p.Definition != nil && p.Definition.Title != "" {
			title = p.Definition.Title
		}
		out.Revisions = append(out.Revisions, ArtifactMetadata{row.ID, row.BaseRevision, row.CreatedAt, title})
		if row.ID == revision {
			out.Artifact = &ArtifactDocument{row.ArtifactID, row.ID, row.BaseRevision, row.StateRevision, row.LocalState, row.Payload, artifactDigest(row.Payload), row.CreatedAt, row.BaseRevision != current}
		}
	}
	if out.Artifact == nil {
		return out, sql.ErrNoRows
	}
	return out, nil
}
func (s *Service) GetArtifact(ctx context.Context, a, e, b, id, revision string) (ArtifactResponse, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return ArtifactResponse{}, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	branches, err := q.ExperienceBranches(ctx, pgq.ExperienceBranchesParams{AccountID: a, ExperienceID: e})
	if err != nil {
		return ArtifactResponse{}, err
	}
	for _, branch := range branches {
		if branch.ID == b {
			return artifactResponse(ctx, q, a, e, b, id, revision, branch.Revision)
		}
	}
	return ArtifactResponse{}, sql.ErrNoRows
}
func artifactPrior(ctx context.Context, q *pgq.Queries, a, r, d string) (*ArtifactResponse, error) {
	row, err := q.ExperienceArtifactReceipt(ctx, pgq.ExperienceArtifactReceiptParams{AccountID: a, RequestID: r})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if row.Digest != d {
		return nil, fail("request_id_conflict")
	}
	var out ArtifactResponse
	if json.Unmarshal(row.Result, &out) != nil {
		return nil, fail("history_unavailable")
	}
	return &out, nil
}
func artifactReceipt(ctx context.Context, q *pgq.Queries, a, e, b, r, d string, out ArtifactResponse) error {
	raw, _ := json.Marshal(out)
	return q.ExperienceArtifactSaveReceipt(ctx, pgq.ExperienceArtifactSaveReceiptParams{AccountID: a, ExperienceID: e, BranchID: b, RequestID: r, Digest: d, Result: raw})
}
func artifactLock(ctx context.Context, q *pgq.Queries, a, e, b string, revision int64) error {
	row, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: a, ExperienceID: e, ID: b})
	if err != nil {
		return err
	}
	if row.Revision != revision {
		return fail("revision_conflict")
	}
	ops, err := q.ExperienceActive(ctx, pgq.ExperienceActiveParams{AccountID: a, ExperienceID: e, BranchID: b})
	if err != nil {
		return err
	}
	if len(ops) > 0 {
		return fail("branch_busy")
	}
	return nil
}
func artifactPublicContext(v View, presentation int) map[string]any {
	facts := []string{}
	prose := []string{}
	for _, info := range v.Information {
		facts = append(facts, info.Text)
		prose = append(prose, info.Name, info.Text)
	}
	recentInputs := []string{}
	start := max(0, len(v.Pages)-3)
	for _, page := range v.Pages[start:] {
		prose = append(prose, page.Text)
		if page.Mode != "begin" {
			recentInputs = append(recentInputs, page.Input)
		}
	}
	var currentTurn any
	if len(v.Pages) > 0 {
		page := v.Pages[len(v.Pages)-1]
		if page.Revision == v.Revision {
			input := page.Input
			if page.Mode == "begin" {
				input = ""
			}
			currentTurn = map[string]any{"revision": page.Revision, "mode": page.Mode, "input": input, "prose": page.Text}
		}
	}
	location, clock := "", ""
	if v.Reader != nil {
		clock = v.Reader.StoryTime
		for _, record := range v.Reader.Records {
			if record.Kind == "location" {
				location = record.Label
			}
		}
	}
	objects := map[string]any{}
	knownObjects := []any{}
	if v.Gameplay != nil {
		var game struct {
			Entities []map[string]any `json:"entities"`
		}
		if json.Unmarshal(v.Gameplay.Game, &game) == nil {
			for _, entity := range game.Entities {
				if id, ok := entity["id"].(string); ok {
					objects[id] = entity
				}
			}
		}
		var experience struct {
			Objects []any `json:"objects"`
		}
		if json.Unmarshal(v.Gameplay.Experience, &experience) == nil && experience.Objects != nil {
			knownObjects = experience.Objects
		}
		location = v.Gameplay.Location
	}
	return map[string]any{"scope": map[string]any{"worldKey": v.ID, "sessionId": v.ID, "branchId": v.BranchID, "sceneId": location, "sourceTurnId": nil, "baseVersion": v.Revision}, "deterministic": true, "gameplay": v.Gameplay, "objects": objects, "knownObjects": knownObjects, "currentTurn": currentTurn, "recentInputs": recentInputs, "facts": facts, "prose": strings.Join(prose, "\n"), "location": location, "time": clock, "reader": v.Reader, "presentationRevision": presentation}
}
func (s *Service) PrepareArtifact(ctx context.Context, a, e string, r ArtifactPrepareRequest, i *FeedbackInterpreter) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || r.ExpectedRevision < 1 || len(r.Intent) > 6000 || (r.InputRouting && !textOK(r.Intent)) {
		return out, fail("invalid_input")
	}
	d := digest("artifact-prepare", e, r)
	prior, err := artifactPrior(ctx, pgq.New(s.DB), a, r.RequestID, d)
	if err != nil {
		return out, err
	}
	if prior != nil {
		return *prior, nil
	}
	view, err := s.Get(ctx, a, e, r.BranchID)
	if err != nil {
		return out, err
	}
	if view.Revision != r.ExpectedRevision {
		return out, fail("revision_conflict")
	}
	if view.Operation != nil && (view.Operation.Status == "pending" || view.Operation.Status == "generating") {
		return out, fail("branch_busy")
	}
	before, err := s.GetArtifact(ctx, a, e, r.BranchID, "", "")
	if err != nil {
		return out, err
	}
	var previous map[string]any
	if before.Artifact != nil {
		if StrictJSON(before.Artifact.Payload, &previous) != nil {
			return out, fail("history_unavailable")
		}
	}
	if !r.Retry && !r.InputRouting && before.Artifact != nil && before.Artifact.BaseRevision == view.Revision && previous["prepareIntent"] == r.Intent {
		return s.retainArtifact(ctx, a, e, r, d, before)
	}
	public := artifactPublicContext(view, len(before.Revisions)+1)
	public["pending"] = nil
	public["inputRouting"] = r.InputRouting
	public["intent"] = r.Intent
	trigger := "automatic"
	if r.InputRouting {
		trigger = "input"
	} else if strings.TrimSpace(r.Intent) != "" {
		trigger = "requested"
	}
	public["preparation"] = map[string]any{"trigger": trigger}
	if before.Artifact != nil {
		definition, _ := previous["definition"].(map[string]any)
		if before.Artifact.BaseRevision == view.Revision {
			public["pending"] = definition
			public["artifact"] = map[string]any{"artifactId": before.Artifact.ArtifactID, "head": before.Artifact.RevisionID, "contentHash": before.Artifact.Digest}
		}
		if definition != nil {
			public["previousPresentation"] = map[string]any{"id": definition["id"], "title": definition["title"], "summary": definition["summary"], "scope": definition["scope"]}
		}
		public["uiArtifact"] = map[string]any{"id": before.Artifact.ArtifactID, "digest": before.Artifact.Digest, "state": before.Artifact.State}
	}

	schema, err := s.Artifacts.run(ctx, map[string]any{"op": "schema"})
	if err != nil {
		return out, err
	}
	if i == nil || i.Model == nil || i.ModelName == "" {
		return out, fail("model_unavailable")
	}
	public["reactAvailable"] = s.Artifacts.CompilerPath != ""
	input, _ := json.Marshal(map[string]any{"public": public, "intent": r.Intent})
	instruction := sourceArtifactPrompt + "\n本次只做公开展示与参数准备，不授予确定执行。只返回 {payload:JSON字符串}，内部为 {definition:完整定义或null,game:公开game update或null,reason:string,stateMigration?:原参数迁移}，或原协议完整定义、decision:keep/none/patch。keep仅当pending存在，none明确无界面；patch限定title/summary/view已有路径，绑定artifact.head和contentHash。game使用以下JSON Schema。所有quote/evidence必须是public.prose逐字片段，未知数值用null。不能用玩家intent作为事实。definition.scope/revision由宿主固定。支持原版标准组件、interactive，以及react（只有配置编译器时才用react）。public.deterministic=true时可为完整确定且已授权的依据提供game apply或dynamic rule，准备过程不结算；玩家明确点击后另由正式服务器审核并提交，不得把预览说成已执行。public.objects是可供表达式引用的当前正式资源，不能用新game内容覆盖已有资源。attempt不含效果。不需要界面时definition=null,game=null并说明reason。\n" + string(schema) + "\nreact={type:react,title,description,source,css,height,initialState} source为TSX，只import react和@story/ui，默认导出组件；@story/ui useArtifactState()返回[state,setState]，默认值在initialState，draft(text)只准备用户草稿。禁止window/document/网络/存储/动态对象属性/反射/ref。stateMigration只允许{map:{旧键:新键},drop:[键]}。"
	if r.InputRouting {
		instruction += "\n" + sourceArtifactIntentPrompt
	}
	req := model.Request{Model: i.ModelName, Schema: json.RawMessage(`{"type":"object","properties":{"payload":{"type":"string"}},"required":["payload"],"additionalProperties":false}`), Messages: []model.Message{{Role: "system", Content: instruction}, {Role: "user", Content: string(input)}}}
	if i.MaxInputBytes > 0 && len(instruction)+len(input) > i.MaxInputBytes {
		return out, fail("context_budget_exceeded")
	}
	req, err = model.VerifyContextBudget(req, i.ContextTokens, min(i.OutputTokens, 8192), i.ByteTokenBoundVerified)
	if err != nil {
		return out, fail("context_budget_exceeded")
	}
	timeout := i.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	modelCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	result, err := i.Model.Generate(modelCtx, req)
	if err != nil {
		return out, fail("model_failed")
	}
	var envelope struct {
		Payload string `json:"payload"`
	}
	if len(result.Text) > 256<<10 || StrictJSON([]byte(result.Text), &envelope) != nil || !json.Valid([]byte(envelope.Payload)) {
		return out, fail("invalid_artifact")
	}
	var decision *ArtifactIntentDecision
	if r.InputRouting {
		var routed json.RawMessage
		decision, routed, err = parseArtifactIntent([]byte(envelope.Payload), before)
		if err != nil {
			return out, err
		}
		if decision.Kind == "story" || decision.Kind == "mixed" || decision.Kind == "clarify" {
			return s.commitArtifactIntent(ctx, a, e, r, d, before, decision)
		}
		envelope.Payload = string(routed)
	}
	var value any
	if StrictJSON([]byte(envelope.Payload), &value) != nil {
		return out, fail("invalid_artifact")
	}
	if proposed, ok := value.(map[string]any); ok && proposed["decision"] == "keep" {
		if before.Artifact == nil || before.Artifact.BaseRevision != view.Revision || previous["definition"] == nil {
			return out, fail("invalid_artifact")
		}
		return s.retainArtifact(ctx, a, e, r, d, before, decision)
	}
	if len(before.Revisions) >= 64 {
		return out, fail("artifact_capacity")
	}
	priorState := json.RawMessage(`{}`)
	if before.Artifact != nil {
		priorState = before.Artifact.State
	}
	prepared, err := s.Artifacts.run(ctx, map[string]any{"op": "prepare", "value": value, "context": public, "previous": previous, "previousState": priorState, "allowScripts": true})
	if err != nil {
		return out, err
	}
	var preparation struct {
		Payload json.RawMessage `json:"payload"`
		State   json.RawMessage `json:"state"`
	}
	if StrictJSON(prepared, &preparation) != nil {
		return out, fail("invalid_artifact")
	}
	payload := preparation.Payload
	var withIntent map[string]any
	if StrictJSON(payload, &withIntent) != nil {
		return out, fail("invalid_artifact")
	}
	withIntent["prepareIntent"] = r.Intent
	payload, _ = json.Marshal(withIntent)

	payload, err = s.Artifacts.compilePayload(ctx, payload)
	if err != nil {
		return out, err
	}
	return s.commitArtifact(ctx, a, e, r.RequestID, r.BranchID, r.ExpectedRevision, d, before, payload, preparation.State, decision)
}

func (s *Service) commitArtifact(ctx context.Context, a, e, requestID, branchID string, revision int64, d string, before ArtifactResponse, payload, state json.RawMessage, decisions ...*ArtifactIntentDecision) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	oldHead, artifactID := "", newID("artifact_")
	if before.Artifact != nil {
		oldHead = before.Artifact.RevisionID
		artifactID = before.Artifact.ArtifactID
	}
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, requestID); err != nil {
			return err
		}
		prior, err := artifactPrior(ctx, q, a, requestID, d)
		if err != nil {
			return err
		}
		if prior != nil {
			out = *prior
			return nil
		}
		if err = artifactLock(ctx, q, a, e, branchID, revision); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: branchID})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if head.RevisionID != oldHead {
			return fail("artifact_conflict")
		}
		if before.Artifact != nil {
			current, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: branchID, ArtifactID: artifactID, ID: oldHead})
			if err != nil {
				return err
			}
			if current.StateRevision != before.Artifact.StateRevision {
				return fail("artifact_conflict")
			}
		}

		id := newID("artifact_revision_")
		if err = q.ExperienceArtifactInsert(ctx, pgq.ExperienceArtifactInsertParams{AccountID: a, ExperienceID: e, BranchID: branchID, ArtifactID: artifactID, ID: id, BaseRevision: revision, Payload: payload, LocalState: state, CreatedAt: time.Now().UTC()}); err != nil {
			return err
		}
		if err = q.ExperienceArtifactSetHead(ctx, pgq.ExperienceArtifactSetHeadParams{AccountID: a, ExperienceID: e, BranchID: branchID, ArtifactID: artifactID, RevisionID: id}); err != nil {
			return err
		}
		out, err = artifactResponse(ctx, q, a, e, branchID, artifactID, id, revision)
		if err != nil {
			return err
		}
		out = withArtifactIntent(out, a, e, branchID, requestID, revision, decisions)
		return artifactReceipt(ctx, q, a, e, branchID, requestID, d, out)
	})
	return out, err
}
func (s *Service) SaveArtifactState(ctx context.Context, a, e, id string, r ArtifactStateRequest) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || !keyOK(r.RevisionID) || r.ExpectedRevision < 1 || r.ExpectedStateRevision < 0 || len(r.State) > 24000 {
		return out, fail("invalid_input")
	}
	var state any
	if StrictJSON(r.State, &state) != nil {
		return out, fail("invalid_input")
	}
	cleaned, err := s.Artifacts.run(ctx, map[string]any{"op": "state", "value": state})
	if err != nil {
		return out, err
	}
	d := digest("artifact-state", e+":"+id, r)
	err = s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		prior, err := artifactPrior(ctx, q, a, r.RequestID, d)
		if err != nil {
			return err
		}
		if prior != nil {
			out = *prior
			return nil
		}
		if err = artifactLock(ctx, q, a, e, r.BranchID, r.ExpectedRevision); err != nil {
			return err
		}
		head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
		if err != nil {
			return err
		}
		if head.ArtifactID != id {
			return sql.ErrNoRows
		}
		if head.RevisionID != r.RevisionID {
			return fail("artifact_conflict")
		}
		row, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ID: r.RevisionID, ArtifactID: id})
		if err != nil {
			return err
		}
		if row.BaseRevision != r.ExpectedRevision {
			return fail("revision_conflict")
		}
		changed, err := q.ExperienceArtifactState(ctx, pgq.ExperienceArtifactStateParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ID: r.RevisionID, StateRevision: r.ExpectedStateRevision, LocalState: cleaned})
		if err != nil {
			return err
		}
		if changed != 1 {
			return fail("artifact_conflict")
		}
		out, err = artifactResponse(ctx, q, a, e, r.BranchID, id, r.RevisionID, r.ExpectedRevision)
		if err != nil {
			return err
		}
		return artifactReceipt(ctx, q, a, e, r.BranchID, r.RequestID, d, out)
	})
	return out, err
}
func (s *Service) RestoreArtifact(ctx context.Context, a, e, id string, r ArtifactRestoreRequest) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || !keyOK(r.RevisionID) || !keyOK(r.ExpectedHead) || r.ExpectedRevision < 1 || r.ExpectedStateRevision < 0 {
		return out, fail("invalid_input")
	}
	d := digest("artifact-restore", e+":"+id, r)
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		prior, err := artifactPrior(ctx, q, a, r.RequestID, d)
		if err != nil {
			return err
		}
		if prior != nil {
			out = *prior
			return nil
		}
		if err = artifactLock(ctx, q, a, e, r.BranchID, r.ExpectedRevision); err != nil {
			return err
		}
		head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
		if err != nil {
			return err
		}
		if head.ArtifactID != id {
			return sql.ErrNoRows
		}
		if head.RevisionID != r.ExpectedHead {
			return fail("artifact_conflict")
		}
		current, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ID: head.RevisionID, ArtifactID: id})
		if err != nil {
			return err
		}
		if current.StateRevision != r.ExpectedStateRevision {
			return fail("artifact_conflict")
		}
		row, err := q.ExperienceArtifactVersion(ctx, pgq.ExperienceArtifactVersionParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ID: r.RevisionID, ArtifactID: id})
		if err != nil {
			return err
		}
		if row.BaseRevision != r.ExpectedRevision {
			return fail("revision_conflict")
		}
		if err = q.ExperienceArtifactSetHead(ctx, pgq.ExperienceArtifactSetHeadParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID, ArtifactID: id, RevisionID: row.ID}); err != nil {
			return err
		}
		out, err = artifactResponse(ctx, q, a, e, r.BranchID, id, row.ID, r.ExpectedRevision)
		if err != nil {
			return err
		}
		return artifactReceipt(ctx, q, a, e, r.BranchID, r.RequestID, d, out)
	})
	return out, err
}

// Original definitions are retained for export/digest. Only the fixed compiler
// produces bundles; model or imported bundle JavaScript is never trusted.
func (r *ArtifactRuntime) compilePayload(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var payload map[string]any
	if StrictJSON(raw, &payload) != nil {
		return nil, fail("invalid_artifact")
	}
	definition, _ := payload["definition"].(map[string]any)
	bundles := map[string]any{}
	var visit func(any) error
	visit = func(v any) error {
		node, ok := v.(map[string]any)
		if !ok {
			return fail("invalid_artifact")
		}
		if node["type"] == "react" {
			if r.CompilerPath == "" {
				return fail("artifact_unavailable")
			}
			input, _ := json.Marshal(map[string]any{"node": node})
			if len(input) > 256<<10 {
				return fail("invalid_artifact")
			}
			compileCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			cmd := exec.CommandContext(compileCtx, r.NodePath, "--max-old-space-size=256", r.CompilerPath)
			cmd.Stdin = bytes.NewReader(input)
			output := limitedArtifactBuffer{limit: 2 << 20}
			cmd.Stdout = &output
			cmd.Stderr = io.Discard
			if cmd.Run() != nil || output.over {
				return fail("invalid_artifact")
			}
			var result struct {
				Bundle json.RawMessage `json:"bundle"`
			}
			if StrictJSON(output.Bytes(), &result) != nil {
				return fail("invalid_artifact")
			}
			// The fixed validator computes the original JS canonical node digest.
			checked, err := r.run(ctx, map[string]any{"op": "bundle", "node": node, "value": result.Bundle})
			if err != nil {
				return err
			}
			var pair struct {
				Key    string `json:"key"`
				Bundle any    `json:"bundle"`
			}
			if StrictJSON(checked, &pair) != nil {
				return fail("invalid_artifact")
			}
			bundles[pair.Key] = pair.Bundle
		}
		if children, ok := node["children"].([]any); ok {
			for _, child := range children {
				if err := visit(child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if definition != nil {
		views, _ := definition["view"].([]any)
		for _, node := range views {
			if err := visit(node); err != nil {
				return nil, err
			}
		}
	}
	payload["bundles"] = bundles
	out, err := json.Marshal(payload)
	if err != nil || len(out) > 2<<20 {
		return nil, fail("invalid_artifact")
	}
	return out, nil
}

type ArtifactImportRequest struct {
	RequestID        string          `json:"request_id"`
	BranchID         string          `json:"branch_id"`
	ExpectedRevision int64           `json:"expected_revision"`
	Definition       json.RawMessage `json:"definition"`
	State            json.RawMessage `json:"state"`
}

func (s *Service) ImportArtifact(ctx context.Context, a, e string, r ArtifactImportRequest) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	if !keyOK(r.RequestID) || !keyOK(r.BranchID) || r.ExpectedRevision < 1 || len(r.Definition) > 512<<10 || len(r.State) > 24000 {
		return out, fail("invalid_input")
	}
	d := digest("artifact-import", e, r)
	prior, err := artifactPrior(ctx, pgq.New(s.DB), a, r.RequestID, d)
	if err != nil {
		return out, err
	}
	if prior != nil {
		return *prior, nil
	}
	v, err := s.Get(ctx, a, e, r.BranchID)
	if err != nil {
		return out, err
	}
	if v.Revision != r.ExpectedRevision {
		return out, fail("revision_conflict")
	}
	before, err := s.GetArtifact(ctx, a, e, r.BranchID, "", "")
	if err != nil {
		return out, err
	}
	if len(before.Revisions) >= 64 {
		return out, fail("artifact_capacity")
	}
	var definition, state any
	if StrictJSON(r.Definition, &definition) != nil || StrictJSON(r.State, &state) != nil || definition == nil {
		return out, fail("invalid_input")
	}
	var game any
	if before.Artifact != nil && before.Artifact.BaseRevision == v.Revision {
		var old map[string]any
		if StrictJSON(before.Artifact.Payload, &old) != nil {
			return out, fail("history_unavailable")
		}
		game = old["sourceGame"]
	}
	payload, err := s.Artifacts.run(ctx, map[string]any{"op": "validate", "value": map[string]any{"definition": definition, "game": game, "reason": "导入公开交互定义"}, "context": artifactPublicContext(v, len(before.Revisions)+1), "allowScripts": true})
	if err != nil {
		return out, err
	}
	clean, err := s.Artifacts.run(ctx, map[string]any{"op": "state", "value": state})
	if err != nil {
		return out, err
	}
	payload, err = s.Artifacts.compilePayload(ctx, payload)
	if err != nil {
		return out, err
	}
	return s.commitArtifact(ctx, a, e, r.RequestID, r.BranchID, r.ExpectedRevision, d, before, payload, clean)
}

func (s *Service) retainArtifact(ctx context.Context, a, e string, r ArtifactPrepareRequest, d string, before ArtifactResponse, decisions ...*ArtifactIntentDecision) (ArtifactResponse, error) {
	out := ArtifactResponse{}
	err := s.transaction(ctx, func(q *pgq.Queries) error {
		if err := requestLock(ctx, q, a, r.RequestID); err != nil {
			return err
		}
		prior, err := artifactPrior(ctx, q, a, r.RequestID, d)
		if err != nil {
			return err
		}
		if prior != nil {
			out = *prior
			return nil
		}
		if err = artifactLock(ctx, q, a, e, r.BranchID, r.ExpectedRevision); err != nil {
			return err
		}
		head, err := q.ExperienceArtifactHead(ctx, pgq.ExperienceArtifactHeadParams{AccountID: a, ExperienceID: e, BranchID: r.BranchID})
		if err != nil {
			return err
		}
		if head.RevisionID != before.Artifact.RevisionID {
			return fail("artifact_conflict")
		}
		out, err = artifactResponse(ctx, q, a, e, r.BranchID, head.ArtifactID, head.RevisionID, r.ExpectedRevision)
		if err != nil {
			return err
		}
		out = withArtifactIntent(out, a, e, r.BranchID, r.RequestID, r.ExpectedRevision, decisions)
		return artifactReceipt(ctx, q, a, e, r.BranchID, r.RequestID, d, out)
	})
	return out, err
}
