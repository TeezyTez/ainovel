//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

type deepQuoteSource struct {
	Root            string          `json:"source_root"`
	EventsSHA       string          `json:"source_events_sha256"`
	RequestEventSHA string          `json:"source_request_event_sha256"`
	ExtractEventSHA string          `json:"source_extract_event_sha256"`
	SourceTreeSHA   string          `json:"source_tree_sha256"`
	RequestRaw      json.RawMessage `json:"original_serialized_request"`
	Request         model.Request   `json:"request"`
	CandidateRaw    json.RawMessage `json:"candidate"`
	Candidate       Candidate       `json:"-"`
	OriginalResult  model.Result    `json:"original_result"`
}

// Read the complete sealed chain, not a detached request. This controlled
// experiment is intentionally bound to NAR-001 call 8 of the failed S01.
func decodeDeepQuoteSource(raw []byte, root string) (*deepQuoteSource, error) {
	if len(raw) == 0 || len(raw) > 32<<20 || raw[len(raw)-1] != '\n' {
		return nil, fmt.Errorf("unsealed or oversized source")
	}
	source := &deepQuoteSource{Root: root, EventsSHA: fmt.Sprintf("%x", sha256.Sum256(raw))}
	previous := ""
	ended := false
	var extracted Candidate
	haveExtract, haveRequest, haveResult := false, false, false
	for i, line := range bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'}) {
		var event struct {
			Seq      int             `json:"seq"`
			Previous string          `json:"previous_sha256"`
			Kind     string          `json:"kind"`
			Step     string          `json:"step"`
			Data     json.RawMessage `json:"data"`
		}
		if !uniqueJSON(line) || json.Unmarshal(line, &event) != nil || event.Seq != i+1 || event.Previous != previous || ended {
			return nil, fmt.Errorf("invalid complete source hash chain")
		}
		previous = fmt.Sprintf("%x", sha256.Sum256(line))
		if i == 0 {
			var manifest struct {
				Fixture struct {
					ID string `json:"id"`
				} `json:"fixture"`
				Source string `json:"source_tree_sha256"`
			}
			if event.Kind != "manifest" || json.Unmarshal(event.Data, &manifest) != nil || manifest.Fixture.ID != "NAR-001" || manifest.Source == "" {
				return nil, fmt.Errorf("unexpected source manifest")
			}
			source.SourceTreeSHA = manifest.Source
		}
		switch event.Seq {
		case 23:
			var result struct {
				Call   int          `json:"call"`
				Result model.Result `json:"result"`
				Error  string       `json:"error"`
			}
			if event.Kind != "model_result" || event.Step != "S01" || json.Unmarshal(event.Data, &result) != nil || result.Call != 7 || result.Error != "" {
				return nil, fmt.Errorf("unexpected extraction event")
			}
			var payload struct {
				Result struct {
					Candidate string `json:"candidate_json"`
				} `json:"result"`
			}
			if StrictJSON([]byte(result.Result.Text), &payload) != nil || StrictJSON([]byte(payload.Result.Candidate), &extracted) != nil || !textOK(extracted.Passage) {
				return nil, fmt.Errorf("invalid original extracted candidate")
			}
			source.ExtractEventSHA, haveExtract = previous, true
		case 25:
			var request struct {
				Call    int             `json:"call"`
				Request json.RawMessage `json:"request"`
			}
			if event.Kind != "model_request" || event.Step != "S01" || json.Unmarshal(event.Data, &request) != nil || request.Call != 8 || StrictJSON(request.Request, &source.Request) != nil {
				return nil, fmt.Errorf("unexpected original review request")
			}
			source.RequestRaw = append(json.RawMessage(nil), request.Request...)
			source.RequestEventSHA, haveRequest = previous, true
		case 26:
			var result struct {
				Call   int          `json:"call"`
				Result model.Result `json:"result"`
				Error  string       `json:"error"`
			}
			if event.Kind != "model_result" || event.Step != "S01" || json.Unmarshal(event.Data, &result) != nil || result.Call != 8 || result.Error != "" {
				return nil, fmt.Errorf("unexpected original review result")
			}
			source.OriginalResult, haveResult = result.Result, true
		}
		if event.Kind == "run_end" {
			var result struct {
				Status string `json:"status"`
			}
			if json.Unmarshal(event.Data, &result) != nil || result.Status != "FAIL" {
				return nil, fmt.Errorf("expected sealed failed source")
			}
			ended = true
		}
	}
	if !ended || previous != root || !haveExtract || !haveRequest || !haveResult {
		return nil, fmt.Errorf("source seal or required events differ")
	}
	conversation := []model.Message{}
	for _, message := range source.Request.Messages {
		switch message.Role {
		case "system":
		case "user", "assistant":
			conversation = append(conversation, message)
		default:
			return nil, fmt.Errorf("unknown original message role")
		}
	}
	if len(conversation) != 1 || conversation[0].Role != "user" {
		return nil, fmt.Errorf("original request is not single-user")
	}
	var input map[string]json.RawMessage
	if StrictJSON([]byte(conversation[0].Content), &input) != nil || StrictJSON(input["candidate"], &source.Candidate) != nil || !textOK(source.Candidate.Passage) {
		return nil, fmt.Errorf("invalid original serialized user input")
	}
	source.CandidateRaw = append(json.RawMessage(nil), input["candidate"]...)
	if !reflect.DeepEqual(source.Candidate, extracted) {
		return nil, fmt.Errorf("review candidate differs from exact extraction")
	}
	if source.Request.Model == "" || source.Request.MaxOutputTokens != 8192 || len(source.Request.Schema) == 0 || !json.Valid(source.Request.Schema) {
		return nil, fmt.Errorf("original review model/schema/output declaration differs")
	}
	// Only restore the nonserialized limit. No prompt/schema/output changes.
	request, err := model.VerifyContextBudget(source.Request, 65536, source.Request.MaxOutputTokens, true)
	if err != nil {
		return nil, err
	}
	source.Request = request
	var before, after any
	if json.Unmarshal(source.RequestRaw, &before) != nil || json.Unmarshal(narrativeJSON(request), &after) != nil || !reflect.DeepEqual(before, after) {
		return nil, fmt.Errorf("serialized request changed during restoration")
	}
	return source, nil
}

type deepQuoteMismatch struct {
	Group     string `json:"group"`
	Index     int    `json:"index"`
	Reference string `json:"reference"`
	Quote     string `json:"quote"`
}

type deepQuoteReviewCheck struct {
	ParseError        string              `json:"parse_error"`
	Approved          bool                `json:"approved"`
	QuoteMismatches   []deepQuoteMismatch `json:"quote_mismatches"`
	VerificationError string              `json:"verification_error"`
}

func checkDeepQuoteReview(candidate Candidate, rawCandidate json.RawMessage, result model.Result) deepQuoteReviewCheck {
	check := deepQuoteReviewCheck{QuoteMismatches: []deepQuoteMismatch{}}
	var wrapped struct {
		Result json.RawMessage `json:"result"`
	}
	var review NarrativeReview
	err := StrictJSON([]byte(result.Text), &wrapped)
	if err == nil {
		err = RequiredJSON(wrapped.Result, "approved", "issues", "supports", "knowledge_supports")
	}
	if err == nil {
		err = StrictJSON(wrapped.Result, &review)
	}
	if err != nil {
		check.ParseError = err.Error()
		return check
	}
	check.Approved = review.Approved
	add := func(group string, index int, reference, quote string) {
		if !strings.Contains(candidate.Passage, quote) {
			check.QuoteMismatches = append(check.QuoteMismatches, deepQuoteMismatch{Group: group, Index: index, Reference: reference, Quote: quote})
		}
	}
	for i, s := range review.Supports {
		add("supports", i, s.FactID, s.Quote)
	}
	for i, s := range review.KnowledgeSupports {
		add("knowledge_supports", i, s.SubjectID+":"+s.FactID, s.Quote)
	}
	for i, s := range review.RevealSupports {
		add("reveal_supports", i, s.Type+":"+s.ID, s.Quote)
	}
	if err := verifyNarrativeApproval(candidate, &NarrativeApproval{Engine: narrativeEngineVersion, Candidate: rawCandidate, Result: review}); err != nil {
		check.VerificationError = err.Error()
	}
	return check
}

// Synthetic sealed inputs test provenance and literal-quote checking only.
func deepQuoteSyntheticSource(t *testing.T, mutate func(map[int]map[string]any)) ([]byte, string) {
	t.Helper()
	c := candidate(Context{State: EmptyState()})
	c.Passage = "第一行\n第二行"
	c.NewFacts = []Fact{{ID: "f", Kind: "fact", Text: "一个事实", Known: true, KnownBy: []string{}, SourceRevision: 2}}
	candidateRaw := narrativeJSON(c)
	request := model.Request{Messages: []model.Message{{Role: "system", Content: "阶段review：检查原字引文"}, {Role: "user", Content: string(narrativeJSON(map[string]any{"candidate": json.RawMessage(candidateRaw), "context": map[string]any{}}))}}, Schema: json.RawMessage(`{"type":"object"}`), Model: "gpt-6.1-sol", MaxOutputTokens: 8192}
	review := NarrativeReview{Approved: true, Issues: []NarrativeIssue{}, Supports: []NarrativeSupport{{FactID: "f", Quote: c.Passage}}, KnowledgeSupports: []NarrativeKnowledgeSupport{}, RevealSupports: []NarrativeRevealSupport{}}
	events := map[int]map[string]any{}
	for i := 1; i <= 32; i++ {
		events[i] = map[string]any{"seq": i, "kind": "stage", "step": "S01", "data": map[string]any{}}
	}
	events[1]["kind"], events[1]["step"], events[1]["data"] = "manifest", "", map[string]any{"fixture": map[string]any{"id": "NAR-001"}, "source_tree_sha256": "synthetic-source"}
	events[23]["kind"], events[23]["data"] = "model_result", map[string]any{"call": 7, "result": model.Result{Text: string(narrativeJSON(map[string]any{"result": map[string]any{"candidate_json": string(candidateRaw)}}))}, "error": ""}
	events[25]["kind"], events[25]["data"] = "model_request", map[string]any{"call": 8, "request": request}
	events[26]["kind"], events[26]["data"] = "model_result", map[string]any{"call": 8, "result": model.Result{Text: string(narrativeJSON(map[string]any{"result": review}))}, "error": ""}
	events[32]["kind"], events[32]["data"] = "run_end", map[string]any{"status": "FAIL"}
	if mutate != nil {
		mutate(events)
	}
	var raw []byte
	previous := ""
	for i := 1; i <= 32; i++ {
		events[i]["previous_sha256"] = previous
		line := narrativeJSON(events[i])
		previous = fmt.Sprintf("%x", sha256.Sum256(line))
		raw = append(raw, line...)
		raw = append(raw, '\n')
	}
	return raw, previous
}

func TestDeepBenchmarkQuoteBridgeSourceAndLiteralQuotes(t *testing.T) {
	raw, root := deepQuoteSyntheticSource(t, nil)
	source, err := decodeDeepQuoteSource(raw, root)
	must(t, err)
	if source.Request.ContextTokenLimit != 65536 || source.Request.MaxOutputTokens != 8192 || source.Candidate.Passage != "第一行\n第二行" {
		t.Fatal("request/candidate changed")
	}
	check := checkDeepQuoteReview(source.Candidate, source.CandidateRaw, source.OriginalResult)
	if check.ParseError != "" || check.VerificationError != "" || len(check.QuoteMismatches) != 0 {
		t.Fatalf("valid original quote rejected: %+v", check)
	}
	var review struct {
		Result NarrativeReview `json:"result"`
	}
	must(t, json.Unmarshal([]byte(source.OriginalResult.Text), &review))
	review.Result.Supports[0].Quote = `第一行\n第二行`
	check = checkDeepQuoteReview(source.Candidate, source.CandidateRaw, model.Result{Text: string(narrativeJSON(review))})
	if check.ParseError != "" || check.VerificationError != "narrative_evidence_missing" || len(check.QuoteMismatches) != 1 {
		t.Fatalf("escaped newline was silently repaired: %+v", check)
	}
	for _, tc := range []struct {
		name   string
		mutate func(map[int]map[string]any)
	}{
		{"candidate_drift", func(events map[int]map[string]any) {
			r := events[25]["data"].(map[string]any)["request"].(model.Request)
			r.Messages[1].Content = strings.Replace(r.Messages[1].Content, "第一行", "改写", 1)
			events[25]["data"].(map[string]any)["request"] = r
		}},
		{"multiple_user", func(events map[int]map[string]any) {
			r := events[25]["data"].(map[string]any)["request"].(model.Request)
			r.Messages = append(r.Messages, r.Messages[1])
			events[25]["data"].(map[string]any)["request"] = r
		}},
		{"wrong_call", func(events map[int]map[string]any) { events[25]["data"].(map[string]any)["call"] = 9 }},
		{"wrong_source_case", func(events map[int]map[string]any) {
			events[1]["data"].(map[string]any)["fixture"] = map[string]any{"id": "NAR-009"}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, seal := deepQuoteSyntheticSource(t, tc.mutate)
			if _, err := decodeDeepQuoteSource(data, seal); err == nil {
				t.Fatal("changed source accepted")
			}
		})
	}
	if _, err := decodeDeepQuoteSource(raw, "wrong-root"); err == nil {
		t.Fatal("wrong seal accepted")
	}
	if _, err := decodeDeepQuoteSource(raw[:len(raw)-1], root); err == nil {
		t.Fatal("unsealed bytes accepted")
	}
}

func TestDeepBenchmarkQuoteBridgeSourcePreflight(t *testing.T) {
	dir := os.Getenv("ELSELIFE_QUOTE_BRIDGE_SOURCE")
	if dir == "" {
		t.Skip("explicit sealed review source required")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
	must(t, err)
	root, err := os.ReadFile(filepath.Join(dir, "root.sha256"))
	must(t, err)
	source, err := decodeDeepQuoteSource(raw, strings.TrimSpace(string(root)))
	must(t, err)
	check := checkDeepQuoteReview(source.Candidate, source.CandidateRaw, source.OriginalResult)
	t.Logf("sealed source=%s request_event=%s single_user=true output=8192 restored_context=65536 original_quote_mismatches=%d original_verify=%s", source.Root, source.RequestEventSHA, len(check.QuoteMismatches), check.VerificationError)
}

// Exactly one real CLI invocation; no Service, database, story generation,
// candidate edits, retries, quote repair or automatic approval is involved.
func TestDeepBenchmarkQuoteBridgeLive(t *testing.T) {
	outDir, sourceDir := os.Getenv("ELSELIFE_QUOTE_BRIDGE_DIR"), os.Getenv("ELSELIFE_QUOTE_BRIDGE_SOURCE")
	if outDir == "" || sourceDir == "" {
		t.Skip("explicit single-call quote bridge experiment required")
	}
	raw, err := os.ReadFile(filepath.Join(sourceDir, "events.jsonl"))
	must(t, err)
	rootBytes, err := os.ReadFile(filepath.Join(sourceDir, "root.sha256"))
	must(t, err)
	source, err := decodeDeepQuoteSource(raw, strings.TrimSpace(string(rootBytes)))
	must(t, err)
	// Parent script owns a new output directory and pins this compiled test.
	file, err := os.OpenFile(filepath.Join(outDir, "events.jsonl"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	must(t, err)
	defer file.Close()
	evidence := &deepEvidence{file: file, step: "NAR-001-S01-review-call8"}
	status := "FAIL"
	defer func() {
		_ = evidence.append("run_end", map[string]any{"status": status})
		_ = os.WriteFile(filepath.Join(outDir, "root.sha256"), []byte(evidence.previous+"\n"), 0600)
	}()
	must(t, os.WriteFile(filepath.Join(outDir, "source-events.jsonl"), raw, 0600))
	must(t, os.WriteFile(filepath.Join(outDir, "source-root.sha256"), rootBytes, 0600))
	must(t, evidence.append("manifest", map[string]any{"kind": "single_review_cli_bridge_experiment", "source": source, "current_source_tree_sha256": os.Getenv("ELSELIFE_QUOTE_BRIDGE_SOURCE_SHA256"), "request_event_seq": 25, "extract_event_seq": 23, "original_result_event_seq": 26, "model_calls_authorized": 1, "retry": false, "context_limit_restored": 65536, "context_limit_reason": "Request.ContextTokenLimit is json:-; original run declared 65536; all serialized fields remain unchanged", "boundary": "Controlled original-request review replay; no world Service, no commit, no full trajectory or semantic/literary acceptance.", "original_check": checkDeepQuoteReview(source.Candidate, source.CandidateRaw, source.OriginalResult)}))
	cli, err := model.NewCodexCLI(os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH"), os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), source.Request.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	must(t, err)
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	must(t, evidence.append("model_request", map[string]any{"call": 1, "request": source.Request, "context_token_limit": source.Request.ContextTokenLimit}))
	started := time.Now()
	result, modelErr := cli.Generate(ctx, source.Request)
	errText := ""
	if modelErr != nil {
		errText = modelErr.Error()
	}
	must(t, evidence.append("model_result", map[string]any{"call": 1, "result": result, "error": errText, "elapsed_ms": time.Since(started).Milliseconds()}))
	check := checkDeepQuoteReview(source.Candidate, source.CandidateRaw, result)
	must(t, evidence.append("review_check", check))
	t.Logf("single CLI call: error=%q parse=%q approved=%v quote_mismatches=%d independent_verify=%q", errText, check.ParseError, check.Approved, len(check.QuoteMismatches), check.VerificationError)
	if modelErr != nil || check.ParseError != "" || check.VerificationError != "" {
		t.Errorf("original review replay did not pass independent approval; evidence retained, no retry")
		return
	}
	status = "STRUCTURAL_APPROVAL_ONLY"
}
