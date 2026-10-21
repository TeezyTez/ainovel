//go:build integration && codexlive

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

type fixedResearchFake func(context.Context, model.Request) (model.Result, error)

func (f fixedResearchFake) Generate(ctx context.Context, request model.Request) (model.Result, error) {
	return f(ctx, request)
}

func fixedResearchSynthetic(t *testing.T, count int) (string, string, fixedResearchManifest) {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, "input", "requests")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	manifest := fixedResearchManifest{Version: 1, ExperimentID: "synthetic-control", Model: "synthetic-model", ContextTokenLimit: 65536, PerCallTimeoutSeconds: 120, BatchTimeoutSeconds: 480}
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("call-%d", index+1)
		request := model.Request{Messages: []model.Message{{Role: "system", Content: "Synthetic external-boundary test."}, {Role: "user", Content: id}}, Schema: json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}`), Model: manifest.Model, MaxOutputTokens: 8192}
		raw, _ := json.Marshal(request)
		name := id + ".json"
		if err := os.WriteFile(filepath.Join(directory, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.Calls = append(manifest.Calls, fixedResearchCall{ID: id, RequestFile: "requests/" + name, RequestSHA256: fmt.Sprintf("%x", sha256.Sum256(raw))})
	}
	path := filepath.Join(root, "input", "manifest.json")
	fixedResearchWriteManifest(t, path, manifest)
	return root, path, manifest
}

func fixedResearchWriteManifest(t *testing.T, path string, manifest fixedResearchManifest) {
	t.Helper()
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestFixedRequestResearchPreservesOrderErrorsAndRawEvidence(t *testing.T) {
	root, path, _ := fixedResearchSynthetic(t, 3)
	plan, err := loadFixedResearch(root, path, "synthetic-model")
	if err != nil {
		t.Fatal(err)
	}
	var seen []string
	provider := fixedResearchFake(func(ctx context.Context, request model.Request) (model.Result, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 120*time.Second || request.ContextTokenLimit != 65536 || request.MaxOutputTokens != 8192 {
			t.Fatalf("missing bounded call: %+v, deadline %v", request, deadline)
		}
		id := request.Messages[1].Content
		seen = append(seen, id)
		if id == "call-2" {
			return model.Result{Text: "partial result retained", Model: request.Model}, errors.New("synthetic external failure")
		}
		return model.Result{Text: "raw result, intentionally not valid JSON: " + id, Model: request.Model}, nil
	})
	out := filepath.Join(root, "output")
	if err = runFixedResearch(context.Background(), plan, out, provider); err == nil {
		t.Fatal("one model error must remain an execution error")
	}
	if !reflect.DeepEqual(seen, []string{"call-1", "call-2", "call-3"}) {
		t.Fatalf("reordered, retried, or selected calls: %v", seen)
	}
	for index, call := range plan.Manifest.Calls {
		stem := fmt.Sprintf("%02d-%s", index+1, call.ID)
		raw, readErr := os.ReadFile(filepath.Join(out, stem+".request.json"))
		if readErr != nil || string(raw) != string(plan.RequestJSON[index]) {
			t.Fatalf("request bytes not preserved: %s, %v", stem, readErr)
		}
		raw, readErr = os.ReadFile(filepath.Join(out, stem+".result.json"))
		var result fixedResearchResult
		if readErr != nil || json.Unmarshal(raw, &result) != nil || result.ID != call.ID {
			t.Fatalf("missing result: %s, %v", stem, readErr)
		}
		if index == 1 && (result.Result.Text != "partial result retained" || result.Error != "synthetic external failure" || result.Status != "ERROR") {
			t.Fatalf("error or partial result changed: %+v", result)
		}
		if index != 1 && (result.Status != "OBSERVED" || !strings.HasPrefix(result.Result.Text, "raw result, intentionally not valid JSON:")) {
			t.Fatalf("content was judged or changed: %+v", result)
		}
	}
	raw, err := os.ReadFile(filepath.Join(out, "manifest.json"))
	if err != nil || string(raw) != string(plan.ManifestJSON) {
		t.Fatal("manifest source bytes not preserved")
	}
	if _, err = os.Stat(filepath.Join(out, "run.json")); err != nil {
		t.Fatal("missing terminal run accounting", err)
	}
}

func TestFixedRequestResearchRejectsUnsafeOrUnfrozenPlans(t *testing.T) {
	for _, name := range []string{"too-many", "duplicate-id", "traversal", "hash", "model", "deadline", "batch", "budget", "request-capacity", "unknown", "duplicate-field", "symbolic-link"} {
		t.Run(name, func(t *testing.T) {
			root, path, manifest := fixedResearchSynthetic(t, 2)
			expectedModel := manifest.Model
			switch name {
			case "too-many":
				manifest.Calls = append(manifest.Calls, manifest.Calls[0], manifest.Calls[0], manifest.Calls[0])
			case "duplicate-id":
				manifest.Calls[1].ID = manifest.Calls[0].ID
			case "traversal":
				manifest.Calls[0].RequestFile = "../elsewhere.json"
			case "hash":
				manifest.Calls[0].RequestSHA256 = strings.Repeat("0", 64)
			case "model":
				expectedModel = "different-model"
			case "deadline":
				manifest.PerCallTimeoutSeconds = 121
			case "batch":
				manifest.BatchTimeoutSeconds = 481
			case "budget":
				manifest.ContextTokenLimit = 65537
			case "request-capacity":
				requestPath := filepath.Join(filepath.Dir(path), manifest.Calls[0].RequestFile)
				var request model.Request
				raw, _ := os.ReadFile(requestPath)
				_ = json.Unmarshal(raw, &request)
				request.Messages[1].Content = strings.Repeat("x", 65536)
				raw, _ = json.Marshal(request)
				_ = os.WriteFile(requestPath, raw, 0600)
				manifest.Calls[0].RequestSHA256 = fmt.Sprintf("%x", sha256.Sum256(raw))
			case "symbolic-link":
				requestPath := filepath.Join(filepath.Dir(path), manifest.Calls[0].RequestFile)
				target := requestPath + ".target"
				if err := os.Rename(requestPath, target); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, requestPath); err != nil {
					t.Skip("symlinks unavailable:", err)
				}
			}
			fixedResearchWriteManifest(t, path, manifest)
			if name == "unknown" || name == "duplicate-field" {
				raw, _ := os.ReadFile(path)
				key := `"unknown":true,`
				if name == "duplicate-field" {
					key = `"version":1,`
				}
				_ = os.WriteFile(path, append([]byte("{"+key), raw[1:]...), 0600)
			}
			if _, err := loadFixedResearch(root, path, expectedModel); err == nil {
				t.Fatal("invalid plan accepted")
			}
		})
	}
}

func TestFixedRequestResearchCancelledBatchAndExclusiveOutput(t *testing.T) {
	root, path, _ := fixedResearchSynthetic(t, 2)
	plan, err := loadFixedResearch(root, path, "synthetic-model")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	provider := fixedResearchFake(func(ctx context.Context, request model.Request) (model.Result, error) {
		calls++
		return model.Result{}, nil
	})
	out := filepath.Join(root, "output")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err = runFixedResearch(ctx, plan, out, provider); err == nil || calls != 0 {
		t.Fatalf("cancelled run executed: %d, %v", calls, err)
	}
	for i, call := range plan.Manifest.Calls {
		raw, err := os.ReadFile(filepath.Join(out, fmt.Sprintf("%02d-%s.result.json", i+1, call.ID)))
		var record fixedResearchResult
		if err != nil || json.Unmarshal(raw, &record) != nil || record.Status != "NOT_RUN" {
			t.Fatalf("missing not-run accounting: %s %v", raw, err)
		}
	}
	before, _ := os.ReadFile(filepath.Join(out, "run.json"))
	if err = runFixedResearch(context.Background(), plan, out, provider); err == nil || calls != 0 {
		t.Fatalf("existing evidence reused: %d, %v", calls, err)
	}
	after, _ := os.ReadFile(filepath.Join(out, "run.json"))
	if string(before) != string(after) {
		t.Fatal("existing evidence was overwritten")
	}
}

func TestFixedRequestResearchCallDeadlineDoesNotSelectivelyStopBatch(t *testing.T) {
	root, path, manifest := fixedResearchSynthetic(t, 2)
	manifest.PerCallTimeoutSeconds = 1
	fixedResearchWriteManifest(t, path, manifest)
	plan, err := loadFixedResearch(root, path, "synthetic-model")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	provider := fixedResearchFake(func(ctx context.Context, request model.Request) (model.Result, error) {
		calls++
		if calls == 1 {
			<-ctx.Done()
			return model.Result{}, ctx.Err()
		}
		if ctx.Err() != nil {
			t.Fatal("first call deadline leaked into next call")
		}
		return model.Result{Text: "second independent observation"}, nil
	})
	out := filepath.Join(root, "output")
	if err = runFixedResearch(context.Background(), plan, out, provider); !errors.Is(err, context.DeadlineExceeded) || calls != 2 {
		t.Fatalf("timeout or fixed continuation lost: %d %v", calls, err)
	}
	raw, err := os.ReadFile(filepath.Join(out, "01-call-1.result.json"))
	var record fixedResearchResult
	if err != nil || json.Unmarshal(raw, &record) != nil || record.Error != context.DeadlineExceeded.Error() || record.Status != "ERROR" {
		t.Fatalf("deadline evidence lost: %s %v", raw, err)
	}
}

func TestFixedRequestResearchEvidenceWriteFailureStopsFurtherCalls(t *testing.T) {
	root, path, _ := fixedResearchSynthetic(t, 2)
	plan, err := loadFixedResearch(root, path, "synthetic-model")
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	out := filepath.Join(root, "output")
	provider := fixedResearchFake(func(ctx context.Context, request model.Request) (model.Result, error) {
		calls++
		// Simulate an unavailable result destination, not a model failure.
		if err := os.Mkdir(filepath.Join(out, "01-call-1.result.json"), 0700); err != nil {
			t.Fatal(err)
		}
		return model.Result{Text: "cannot persist"}, nil
	})
	if err = runFixedResearch(context.Background(), plan, out, provider); err == nil || calls != 1 {
		t.Fatalf("ran a later call without being able to retain evidence: %d %v", calls, err)
	}
	if _, err = os.Stat(filepath.Join(out, "01-call-1.started.json")); err != nil {
		t.Fatal("interrupted call start marker lost")
	}
	if _, err = os.Stat(filepath.Join(out, "run.json")); !os.IsNotExist(err) {
		t.Fatal("interrupted persistence must not masquerade as sealed completion")
	}
}
