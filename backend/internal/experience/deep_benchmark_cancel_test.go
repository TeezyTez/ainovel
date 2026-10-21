//go:build integration && codexlive

package experience

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"elselife/backend/internal/algorithm/channel"
	"elselife/backend/internal/capability/model"
	"elselife/backend/internal/platform/database"
)

type deepControlEvent struct {
	Seq  int             `json:"seq"`
	Step string          `json:"step"`
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data"`
}

func deepControlEvents(evidence *deepEvidence) ([]deepControlEvent, error) {
	evidence.mu.Lock()
	defer evidence.mu.Unlock()
	raw, err := os.ReadFile(evidence.file.Name())
	if err != nil {
		return nil, err
	}
	var events []deepControlEvent
	for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var event deepControlEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return nil, err
		}
		if event.Step == evidence.step {
			events = append(events, event)
		}
	}
	return events, nil
}

type deepPausedReview struct {
	Call        int             `json:"model_call"`
	RequestSeq  int             `json:"review_request_event_seq"`
	ResultSeq   int             `json:"review_result_event_seq"`
	Candidate   json.RawMessage `json:"candidate"`
	Request     model.Request   `json:"model_request"`
	Result      model.Result    `json:"model_result"`
	Eligibility string          `json:"candidate_commit_eligibility"`
	Operation   Operation       `json:"operation"`
	err         error
}

func deepCaptureReview(evidence *deepEvidence) (capture deepPausedReview) {
	capture.Eligibility = "not_established"
	events, err := deepControlEvents(evidence)
	if err != nil {
		capture.err = err
		return
	}
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		if event.Kind != "model_result" {
			continue
		}
		var result struct {
			Call   int          `json:"call"`
			Result model.Result `json:"result"`
			Error  string       `json:"error"`
		}
		if err = json.Unmarshal(event.Data, &result); err != nil {
			break
		}
		if result.Call < 1 || result.Error != "" {
			err = fmt.Errorf("review model call did not return an original result")
			break
		}
		capture.Call, capture.ResultSeq, capture.Result = result.Call, event.Seq, result.Result
		for j := i - 1; j >= 0; j-- {
			if events[j].Kind != "model_request" {
				continue
			}
			var request struct {
				Call    int           `json:"call"`
				Request model.Request `json:"request"`
			}
			if err = json.Unmarshal(events[j].Data, &request); err != nil {
				break
			}
			if request.Call != capture.Call {
				continue
			}
			capture.RequestSeq, capture.Request = events[j].Seq, request.Request
			for _, message := range request.Request.Messages {
				if message.Role != "user" {
					continue
				}
				var input map[string]json.RawMessage
				if json.Unmarshal([]byte(message.Content), &input) != nil || input["candidate"] == nil {
					continue
				}
				if capture.Candidate != nil {
					err = fmt.Errorf("ambiguous original review candidate")
					break
				}
				var candidate Candidate
				if err = StrictJSON(input["candidate"], &candidate); err != nil {
					break
				}
				if !textOK(candidate.Passage) {
					err = fmt.Errorf("original review has no narrative candidate")
					break
				}
				capture.Candidate = append(json.RawMessage(nil), input["candidate"]...)
			}
			break
		}
		break
	}
	if err == nil && (capture.RequestSeq == 0 || capture.ResultSeq == 0 || len(capture.Candidate) == 0) {
		err = fmt.Errorf("missing original review request/result/candidate")
	}
	capture.err = err
	return
}

func readDeepControlHistory(ctx context.Context, s *Service, account string, scope View) (deepRestoredReadback, error) {
	view, err := s.Get(ctx, account, scope.ID, scope.BranchID)
	result := deepRestoredReadback{View: view, Snapshots: []deepRestoredSnapshot{}}
	if err != nil {
		return result, err
	}
	if view.Revision < 1 || int64(len(view.Pages)) != view.Revision {
		return result, fmt.Errorf("incomplete formal history")
	}
	for revision := int64(1); revision <= view.Revision; revision++ {
		if view.Pages[revision-1].Revision != revision {
			return result, fmt.Errorf("non-contiguous formal history")
		}
		snapshotView := view
		snapshotView.Revision = revision
		state, err := deepSnapshot(ctx, s, account, snapshotView)
		if err != nil {
			return result, err
		}
		result.Snapshots = append(result.Snapshots, deepRestoredSnapshot{Revision: revision, State: state})
	}
	return result, nil
}

func deepSameControlHistory(a, b deepRestoredReadback) bool {
	// Operation/progress/fence scheduling may change; formal pages, every
	// snapshot, branch revisions and the entire reader projection may not.
	a.View.Operation, b.View.Operation = nil, nil
	a.View.UpdatedAt, b.View.UpdatedAt = time.Time{}, time.Time{}
	return reflect.DeepEqual(a, b)
}

// Evaluation-only scheduling at the real Algorithm observer. No model bytes,
// candidate fields, production methods or Generator interfaces are substituted.
// A review response is not yet an approved, commit-eligible candidate here.
func runDeepRestoreCancel(ctx context.Context, s *Service, dsn, account string, before View, step deepStep, evidence *deepEvidence) (View, State, error) {
	algorithm, ok := s.Generator.(*Algorithm)
	if !ok || !s.NarrativeEngine || evidence == nil || step.Mode != "harness" {
		return before, EmptyState(), fmt.Errorf("restore/cancel requires a real narrative Algorithm and harness step")
	}
	baseline, err := readDeepControlHistory(ctx, s, account, before)
	if err != nil {
		return before, EmptyState(), err
	}
	if !reflect.DeepEqual(baseline.View, before) {
		return baseline.View, EmptyState(), fmt.Errorf("restore source changed before control request")
	}
	state := baseline.Snapshots[len(baseline.Snapshots)-1].State
	request := AdvanceRequest{RequestID: "benchmark-control-" + step.ID, BranchID: before.BranchID, ExpectedRevision: before.Revision, Mode: "read"}
	if err = evidence.append("control_request", map[string]any{"step": step, "kind": "restore_cancel", "request": request, "before": state, "public_view": baseline.View, "before_snapshots": baseline.Snapshots}); err != nil {
		return before, state, err
	}
	db, err := database.OpenServing(ctx, dsn)
	if err != nil {
		return before, state, fmt.Errorf("fresh serving database connection unavailable")
	}
	defer db.Close()
	copyAlgorithm := *algorithm
	restored := &Service{DB: db, Generator: &copyAlgorithm, NarrativeEngine: s.NarrativeEngine, PrepareDispatch: s.PrepareDispatch, ProseFirst: s.ProseFirst, Artifacts: s.Artifacts, LeaseSeconds: s.LeaseSeconds, MaxContextBytes: s.MaxContextBytes, RecentRevisions: s.RecentRevisions, ReadLimits: s.ReadLimits}
	err = restored.RecoverExpired(ctx)
	recovered, readErr := readDeepControlHistory(ctx, restored, account, before)
	err = errors.Join(err, readErr)
	if err == nil && !deepSameControlHistory(baseline, recovered) {
		err = fmt.Errorf("formal history changed during restore")
	}
	restoreError := ""
	if err != nil {
		restoreError = err.Error()
	}
	if writeErr := evidence.append("restore_readback", map[string]any{"public_view": recovered.View, "snapshots": recovered.Snapshots, "new_service": true, "new_db_connection": true, "process_restart": false, "recovery_method": "RecoverExpired", "error": restoreError}); writeErr != nil {
		return recovered.View, state, writeErr
	}
	if err != nil {
		return recovered.View, state, err
	}
	started := time.Now()
	op, fresh, advanceErr := restored.Advance(ctx, account, before.ID, request)
	pending, pendingErr := readDeepControlHistory(ctx, restored, account, before)
	pendingWriteErr := evidence.append("cancel_pending", map[string]any{"request": request, "operation": op, "snapshot": state, "public_view": pending.View})
	controlErr := errors.Join(advanceErr, pendingErr, pendingWriteErr)
	if controlErr == nil && (!fresh || op.Status != "pending" || !deepSameControlHistory(baseline, pending)) {
		controlErr = fmt.Errorf("cancel control did not accept a fresh pending operation with unchanged history")
	}
	var generationErr error
	reviewReached := false
	if controlErr != nil && fresh {
		// A readback/evidence failure must not strand the newly accepted work.
		audit, cancelAudit := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		cancelled, cancelErr := restored.Cancel(audit, account, before.ID, request.RequestID)
		controlErr = errors.Join(controlErr, cancelErr, evidence.append("cancel_issued", map[string]any{"operation": cancelled}))
		cancelAudit()
	}
	if controlErr == nil {
		generationContext, stopGeneration := context.WithCancel(ctx)
		defer stopGeneration()
		paused := make(chan deepPausedReview, 1)
		release := make(chan struct{})
		var releaseOnce sync.Once
		resume := func() { releaseOnce.Do(func() { close(release) }) }
		defer resume()
		observer := copyAlgorithm.StageObserver
		seenReview := false
		copyAlgorithm.StageObserver = func(stage string, elapsed time.Duration, errorCode string) {
			if observer != nil {
				observer(stage, elapsed, errorCode)
			}
			if stage != "review" || errorCode != "" || seenReview {
				return
			}
			seenReview = true
			paused <- deepCaptureReview(evidence)
			// Block before pipeline.after/answerModel; the original response
			// remains in Algorithm's stack and is forwarded unchanged.
			<-release
		}
		done := make(chan error, 1)
		go func() { done <- restored.GenerateAccepted(generationContext, account, request.RequestID) }()
		finished := false
		select {
		case capture := <-paused:
			reviewReached = capture.err == nil
			controlErr = capture.err
			audit, cancelAudit := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			capture.Operation, err = restored.GetOperation(audit, account, before.ID, request.RequestID)
			controlErr = errors.Join(controlErr, err)
			if err == nil && (capture.Operation.Status != "generating" || capture.Operation.CommittedRevision != nil) {
				controlErr = errors.Join(controlErr, fmt.Errorf("review pause operation is not generating"))
			}
			if capture.err == nil {
				controlErr = errors.Join(controlErr, evidence.append("cancel_pause", capture))
			}
			cancelled, cancelErr := restored.Cancel(audit, account, before.ID, request.RequestID)
			controlErr = errors.Join(controlErr, cancelErr, evidence.append("cancel_issued", map[string]any{"operation": cancelled}))
			cancelAudit()
			resume()
		case generationErr = <-done:
			finished = true
			controlErr = fmt.Errorf("review was not reached; generation: %v", generationErr)
		case <-ctx.Done():
			controlErr = fmt.Errorf("review was not reached: %w", ctx.Err())
			audit, cancelAudit := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			cancelled, cancelErr := restored.Cancel(audit, account, before.ID, request.RequestID)
			controlErr = errors.Join(controlErr, cancelErr, evidence.append("cancel_issued", map[string]any{"operation": cancelled}))
			cancelAudit()
			resume()
			stopGeneration()
		}
		if !finished {
			select {
			case generationErr = <-done:
			case <-time.After(30 * time.Second):
				stopGeneration()
				controlErr = errors.Join(controlErr, fmt.Errorf("generation did not finish after cancellation"))
				// Real providers obey context cancellation. Join before auditing
				// so no later model event can be attributed to a different step.
				generationErr = <-done
			}
		}
	}
	audit, cancelAudit := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancelAudit()
	after, readErr := readDeepControlHistory(audit, restored, account, before)
	op, opErr := restored.GetOperation(audit, account, before.ID, request.RequestID)
	readOnly := readErr == nil && deepSameControlHistory(baseline, after)
	controlErr = errors.Join(controlErr, readErr, opErr)
	if !readOnly {
		controlErr = errors.Join(controlErr, fmt.Errorf("formal history changed during restore/cancel"))
	}
	if controlErr == nil && (!reviewReached || op.Status != "cancelled" || op.CommittedRevision != nil) {
		controlErr = fmt.Errorf("review cancellation did not preserve a cancelled uncommitted operation")
	}
	if len(after.Snapshots) > 0 {
		state = after.Snapshots[len(after.Snapshots)-1].State
	}
	events, eventErr := deepControlEvents(evidence)
	controlErr = errors.Join(controlErr, eventErr)
	calls := 0
	for _, event := range events {
		if event.Kind == "model_request" {
			calls++
		}
	}
	errText, generationError := "", ""
	if controlErr != nil {
		errText = controlErr.Error()
	}
	if generationErr != nil {
		generationError = generationErr.Error()
	}
	if writeErr := evidence.append("cancel_result", map[string]any{"operation": op, "public_view": after.View, "snapshot": state, "snapshots": after.Snapshots, "model_calls": calls, "elapsed_ms": time.Since(started).Milliseconds(), "generation_error": generationError, "error": errText, "read_only_verified": readOnly, "review_reached": reviewReached}); writeErr != nil {
		return after.View, state, writeErr
	}
	return after.View, state, controlErr
}

func deepCancelFixture(t *testing.T, link *channel.Link, fixtureModel *syntheticPipelineModel) (*Service, *sql.DB, string, View, deepStep, *deepEvidence, string) {
	t.Helper()
	s, admin, dsn := testService(t)
	// Two committed synthetic pages let the drift control alter an earlier
	// snapshot without touching the latest revision or its public projection.
	v := begin(t, s, "cancel-regression", "initial")
	v = advance(t, s, "cancel-regression", v, "second", "read")
	evidence, path := deepEditorialEvidence(t)
	s.NarrativeEngine = true
	s.Generator = &Algorithm{Link: link, Model: &deepMeasuredModel{Generator: fixtureModel, evidence: evidence}, ModelName: "synthetic-cancel-control", Timeout: 5 * time.Second, MaxModelCalls: 12, ModelContextTokens: 65536, MaxOutputTokens: 8192, ModelByteTokenBoundVerified: true}
	return s, admin, dsn, v, deepStep{ID: "S06", Mode: "harness", Input: "合成评估控制步骤；此句不得进入模型。"}, evidence, path
}

func TestDeepBenchmarkRestoreCancelRequiresOriginalReviewCandidate(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		candidate                json.RawMessage
		duplicate, missingResult bool
	}{
		{name: "null_candidate", candidate: json.RawMessage(`null`)},
		{name: "missing_candidate"},
		{name: "duplicate_candidate", candidate: narrativeJSON(candidate(Context{State: EmptyState()})), duplicate: true},
		{name: "missing_result", candidate: narrativeJSON(candidate(Context{State: EmptyState()})), missingResult: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			evidence, _ := deepEditorialEvidence(t)
			content := string(narrativeJSON(map[string]any{"candidate": tc.candidate}))
			if tc.candidate == nil {
				content = `{"context":{}}`
			}
			request := model.Request{Messages: []model.Message{{Role: "user", Content: content}}}
			if tc.duplicate {
				request.Messages = append(request.Messages, request.Messages[0])
			}
			must(t, evidence.append("model_request", map[string]any{"call": 7, "request": request}))
			if !tc.missingResult {
				must(t, evidence.append("model_result", map[string]any{"call": 7, "result": model.Result{Text: `{"result":{"approved":true}}`}, "error": ""}))
			}
			if capture := deepCaptureReview(evidence); capture.err == nil {
				t.Fatalf("accepted %s as actual review evidence", tc.name)
			}
		})
	}
}

func TestDeepBenchmarkRestoreCancelActualRustControls(t *testing.T) {
	addr := actualReadRuntime(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	link := channel.NewLink(ctx, channel.ClientOptions{Addr: addr, Transport: channel.ClientTransportConfig{InsecurePlaintext: true}})
	defer link.Close()
	t.Run("approved_candidate_commits_without_cancel", func(t *testing.T) {
		m := &syntheticPipelineModel{}
		s, _, _, before, _, _, _ := deepCancelFixture(t, link, m)
		request := AdvanceRequest{RequestID: "uncancelled-control", BranchID: before.BranchID, ExpectedRevision: before.Revision, Mode: "read"}
		_, fresh, err := s.Advance(ctx, "cancel-regression", before.ID, request)
		must(t, err)
		if !fresh {
			t.Fatal("positive control did not accept fresh operation")
		}
		must(t, s.GenerateAccepted(ctx, "cancel-regression", request.RequestID))
		after, err := s.Get(ctx, "cancel-regression", before.ID, before.BranchID)
		must(t, err)
		op, err := s.GetOperation(ctx, "cancel-regression", before.ID, request.RequestID)
		must(t, err)
		if after.Revision != before.Revision+1 || op.Status != "committed" || m.calls != 6 {
			t.Fatalf("positive control did not commit: op=%+v calls=%d revision=%d", op, m.calls, after.Revision)
		}
	})
	for _, tc := range []struct {
		name, fault             string
		reject, capacity, drift bool
		wantCalls               int
		wantError               string
	}{
		{name: "approved_review_cancelled", wantCalls: 6},
		{name: "rejected_review_cancelled", reject: true, wantCalls: 6},
		{name: "no_review_is_failure", fault: "semantic_reference", wantCalls: 5, wantError: "review was not reached"},
		{name: "capacity_semantics_preserved", capacity: true, wantCalls: 0, wantError: "review was not reached"},
		{name: "historical_snapshot_drift_detected", drift: true, wantCalls: 6, wantError: "formal history changed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &syntheticPipelineModel{rejectOnce: tc.reject, extractFault: tc.fault}
			s, admin, dsn, before, step, evidence, path := deepCancelFixture(t, link, m)
			algorithm := s.Generator.(*Algorithm)
			if tc.capacity {
				algorithm.ModelByteTokenBoundVerified = false
			}
			var observed []string
			var driftErr error
			algorithm.StageObserver = func(stage string, _ time.Duration, _ string) {
				observed = append(observed, stage)
				if tc.drift && stage == "review" {
					_, driftErr = admin.ExecContext(ctx, `UPDATE experience_pages SET state=jsonb_set(state,'{facts,1,text}',to_jsonb('synthetic private audit drift'::text)) WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND revision=1`, "cancel-regression", before.ID, before.BranchID)
				}
			}
			after, _, err := runDeepRestoreCancel(ctx, s, dsn, "cancel-regression", before, step, evidence)
			if tc.wantError == "" {
				must(t, err)
			} else if err == nil || !strings.Contains(err.Error(), tc.wantError) {
				t.Fatalf("error=%v want=%q", err, tc.wantError)
			}
			must(t, driftErr)
			if m.calls != tc.wantCalls {
				t.Fatalf("calls=%d want=%d stages=%v", m.calls, tc.wantCalls, m.stages)
			}
			if after.Revision != before.Revision || !reflect.DeepEqual(after.Pages, before.Pages) {
				t.Fatal("cancel test modified formal pages")
			}
			if s.Generator != algorithm || algorithm.ModelByteTokenBoundVerified == tc.capacity {
				t.Fatal("adapter changed original Algorithm/capacity configuration")
			}
			var auditCount int
			must(t, admin.QueryRowContext(ctx, `SELECT count(*) FROM experience_model_inputs WHERE account_id=$1 AND operation_id=$2`, "cancel-regression", "benchmark-control-S06").Scan(&auditCount))
			if auditCount != tc.wantCalls {
				t.Fatalf("ReadingGenerator model audit lost: count=%d calls=%d", auditCount, tc.wantCalls)
			}
			if len(observed) != tc.wantCalls {
				t.Fatalf("original stage observer not preserved: %v", observed)
			}
			events := deepEditorialEvents(t, path)
			originalEvents, evidenceErr := deepControlEvents(evidence)
			must(t, evidenceErr)
			bySequence := map[int]deepControlEvent{}
			for _, event := range originalEvents {
				bySequence[event.Seq] = event
			}
			pauseCount, resultCount := 0, 0
			for _, event := range events {
				if strings.Contains(string(event.Data), dsn) {
					t.Fatal("DSN leaked to evidence")
				}
				if event.Kind == "model_request" && strings.Contains(string(event.Data), step.Input) {
					t.Fatal("harness instruction entered model input")
				}
				switch event.Kind {
				case "restore_readback":
					var v struct {
						NewService     bool                   `json:"new_service"`
						NewConnection  bool                   `json:"new_db_connection"`
						ProcessRestart bool                   `json:"process_restart"`
						Snapshots      []deepRestoredSnapshot `json:"snapshots"`
					}
					must(t, json.Unmarshal(event.Data, &v))
					if !v.NewService || !v.NewConnection || v.ProcessRestart || len(v.Snapshots) != 2 {
						t.Fatalf("invalid recovery scope: %+v", v)
					}
				case "cancel_pause":
					pauseCount++
					var capture deepPausedReview
					must(t, json.Unmarshal(event.Data, &capture))
					var originalRequest struct {
						Call    int           `json:"call"`
						Request model.Request `json:"request"`
					}
					var originalResult struct {
						Call   int          `json:"call"`
						Result model.Result `json:"result"`
					}
					must(t, json.Unmarshal(bySequence[capture.RequestSeq].Data, &originalRequest))
					must(t, json.Unmarshal(bySequence[capture.ResultSeq].Data, &originalResult))
					if capture.Call != originalRequest.Call || capture.Call != originalResult.Call || !reflect.DeepEqual(capture.Request, originalRequest.Request) || !reflect.DeepEqual(capture.Result, originalResult.Result) {
						t.Fatal("paused review does not exactly match original model event references")
					}
					var v struct {
						Candidate   Candidate `json:"candidate"`
						Eligibility string    `json:"candidate_commit_eligibility"`
						ModelResult struct {
							Text string `json:"text"`
						} `json:"model_result"`
					}
					must(t, json.Unmarshal(event.Data, &v))
					if !reflect.DeepEqual(v.Candidate, m.current) || v.Eligibility != "not_established" {
						t.Fatal("review candidate or eligibility invented")
					}
					var raw struct {
						Result NarrativeReview `json:"result"`
					}
					must(t, json.Unmarshal([]byte(v.ModelResult.Text), &raw))
					if raw.Result.Approved == tc.reject {
						t.Fatal("review model result was rewritten")
					}
				case "cancel_result":
					resultCount++
					var v struct {
						Operation     Operation `json:"operation"`
						ReadOnly      bool      `json:"read_only_verified"`
						ReviewReached bool      `json:"review_reached"`
						Error         string    `json:"error"`
					}
					must(t, json.Unmarshal(event.Data, &v))
					if v.ReadOnly == tc.drift || (v.Error == "") != (tc.wantError == "") {
						t.Fatalf("dishonest final result: %+v", v)
					}
					if tc.wantCalls == 6 && (v.Operation.Status != "cancelled" || v.Operation.CommittedRevision != nil || !v.ReviewReached) {
						t.Fatalf("cancel did not fence actual operation: %+v", v)
					}
				}
			}
			if resultCount != 1 || (pauseCount == 1) != (tc.wantCalls == 6) {
				t.Fatalf("events missing/extra: pause=%d result=%d", pauseCount, resultCount)
			}
		})
	}
}
