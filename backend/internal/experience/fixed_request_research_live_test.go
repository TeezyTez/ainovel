//go:build integration && codexlive

package experience

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"elselife/backend/internal/capability/model"
)

type fixedResearchCall struct {
	ID            string `json:"id"`
	RequestFile   string `json:"request_file"`
	RequestSHA256 string `json:"request_sha256"`
}

type fixedResearchManifest struct {
	Version               int                 `json:"version"`
	ExperimentID          string              `json:"experiment_id"`
	Model                 string              `json:"model"`
	ContextTokenLimit     int                 `json:"context_token_limit"`
	PerCallTimeoutSeconds int                 `json:"per_call_timeout_seconds"`
	BatchTimeoutSeconds   int                 `json:"batch_timeout_seconds"`
	Calls                 []fixedResearchCall `json:"calls"`
}

type fixedResearchPlan struct {
	Manifest     fixedResearchManifest
	ManifestJSON []byte
	Requests     []model.Request
	RequestJSON  [][]byte
	Root         string
	Provider     map[string]string
}

type fixedResearchGenerator interface {
	Generate(context.Context, model.Request) (model.Result, error)
}

type fixedResearchResult struct {
	ID             string                        `json:"id"`
	Status         string                        `json:"status"`
	Result         model.Result                  `json:"result"`
	Error          string                        `json:"error"`
	ElapsedMS      int64                         `json:"elapsed_ms"`
	FailureDetails *model.CodexFailureDiagnostic `json:"failure_details,omitempty"`
	UsageObserved  json.RawMessage               `json:"usage_observed,omitempty"`
	RequestSHA256  string                        `json:"request_sha256"`
	StartedAt      time.Time                     `json:"started_at,omitempty"`
}

// This adapter observes fixed requests. It performs no pipeline, DB, content
// grading, retry, repair, or candidate selection. Result is the exact model API
// result (CodexCLI already normalizes its transport); it is not raw CLI stdout.
func loadFixedResearch(root, manifestPath, expectedModel string) (fixedResearchPlan, error) {
	plan := fixedResearchPlan{Root: root}
	if err := fixedResearchContained(root, manifestPath); err != nil {
		return plan, err
	}
	raw, err := fixedResearchRead(manifestPath)
	if err != nil {
		return plan, err
	}
	if err = StrictJSON(raw, &plan.Manifest); err != nil {
		return plan, fmt.Errorf("manifest: %w", err)
	}
	m := plan.Manifest
	validID := regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$`)
	if m.Version != 1 || !validID.MatchString(m.ExperimentID) || m.Model == "" || m.Model != expectedModel ||
		m.ContextTokenLimit != 65536 || m.PerCallTimeoutSeconds < 1 || m.PerCallTimeoutSeconds > 120 ||
		m.BatchTimeoutSeconds < 1 || m.BatchTimeoutSeconds > 480 || len(m.Calls) < 1 || len(m.Calls) > 4 {
		return plan, errors.New("invalid research limits or model configuration")
	}
	plan.ManifestJSON = raw
	seen := map[string]bool{}
	for _, call := range m.Calls {
		if !validID.MatchString(call.ID) || seen[call.ID] || filepath.IsAbs(call.RequestFile) ||
			strings.Contains(call.RequestFile, `\`) || call.RequestFile == "" {
			return plan, errors.New("invalid or duplicate research call")
		}
		seen[call.ID] = true
		for _, part := range strings.Split(call.RequestFile, "/") {
			if part == "" || part == "." || part == ".." {
				return plan, errors.New("invalid request relative path")
			}
		}
		path := filepath.Join(filepath.Dir(manifestPath), filepath.FromSlash(call.RequestFile))
		if err = fixedResearchContained(filepath.Dir(manifestPath), path); err != nil {
			return plan, err
		}
		raw, err = fixedResearchRead(path)
		if err != nil {
			return plan, err
		}
		if fmt.Sprintf("%x", sha256.Sum256(raw)) != call.RequestSHA256 {
			return plan, fmt.Errorf("%s: request hash mismatch", call.ID)
		}
		var request model.Request
		if err = StrictJSON(raw, &request); err != nil {
			return plan, fmt.Errorf("%s: %w", call.ID, err)
		}
		if request.Model != m.Model || request.MaxOutputTokens != 8192 || len(request.Messages) == 0 || len(request.Schema) == 0 || string(request.Schema) == "null" {
			return plan, fmt.Errorf("%s: request model, schema, messages or output budget mismatch", call.ID)
		}
		for _, message := range request.Messages {
			if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
				return plan, fmt.Errorf("%s: unsupported message role", call.ID)
			}
		}
		request, err = model.VerifyContextBudget(request, 65536, 8192, true)
		if err != nil {
			return plan, fmt.Errorf("%s: %w", call.ID, err)
		}
		plan.Requests = append(plan.Requests, request)
		plan.RequestJSON = append(plan.RequestJSON, raw)
	}
	return plan, nil
}

func runFixedResearch(ctx context.Context, plan fixedResearchPlan, output string, generator fixedResearchGenerator) error {
	if err := fixedResearchContained(plan.Root, output); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
		return err
	}
	// Exclusive creation: existing or interrupted evidence is never overwritten.
	if err := os.Mkdir(output, 0700); err != nil {
		return err
	}
	// Keep Go's monotonic clock for elapsed times; UTC conversion strips it.
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(plan.Manifest.BatchTimeoutSeconds)*time.Second)
	defer cancel()
	hashes := map[string]string{}
	write := func(name string, raw []byte) error {
		f, err := os.OpenFile(filepath.Join(output, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, writeErr := f.Write(raw)
		syncErr := f.Sync()
		closeErr := f.Close()
		if err = errors.Join(writeErr, syncErr, closeErr); err != nil {
			return err
		}
		hashes[name] = fmt.Sprintf("%x", sha256.Sum256(raw))
		return nil
	}
	writeJSON := func(name string, value any) error {
		raw, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		return write(name, append(raw, '\n'))
	}
	if err := write("manifest.json", plan.ManifestJSON); err != nil {
		return err
	}
	// Freeze every request before the first call. Later input-file edits cannot
	// change this run; the original bytes remain independently inspectable.
	for index, call := range plan.Manifest.Calls {
		if err := write(fmt.Sprintf("%02d-%s.request.json", index+1, call.ID), plan.RequestJSON[index]); err != nil {
			return err
		}
	}
	if err := writeJSON("run-start.json", map[string]any{
		"kind": "exploratory_fixed_requests", "started_at": started.UTC(),
		"provider": plan.Provider, "context_token_limit": 65536,
		"max_output_tokens": 8192, "request_count": len(plan.Manifest.Calls),
		"result_boundary": "unmodified model.Result and error; not raw CLI stdout",
		"quality_verdict": "NOT_EVALUATED", "database_access": false,
	}); err != nil {
		return err
	}
	var failures []error
	called, notRun := 0, 0
	for index, call := range plan.Manifest.Calls {
		stem := fmt.Sprintf("%02d-%s", index+1, call.ID)
		record := fixedResearchResult{ID: call.ID, RequestSHA256: call.RequestSHA256}
		if err := ctx.Err(); err != nil {
			record.Status, record.Error = "NOT_RUN", err.Error()
			notRun++
			failures = append(failures, err)
		} else {
			callStarted := time.Now()
			record.StartedAt = callStarted.UTC()
			if err := writeJSON(stem+".started.json", map[string]any{"id": call.ID, "started_at": record.StartedAt, "request_sha256": call.RequestSHA256}); err != nil {
				return err // No further calls when evidence cannot be persisted.
			}
			callCtx, callCancel := context.WithTimeout(ctx, time.Duration(plan.Manifest.PerCallTimeoutSeconds)*time.Second)
			result, modelErr := generator.Generate(callCtx, plan.Requests[index])
			callCancel()
			record.ElapsedMS = time.Since(callStarted).Milliseconds()
			record.Result, record.Status = result, "OBSERVED"
			input, output, total := result.Usage.Units()
			record.UsageObserved, _ = json.Marshal(map[string]*int64{"prompt_tokens": input, "completion_tokens": output, "total_tokens": total})
			called++
			if modelErr != nil {
				record.Status, record.Error = "ERROR", modelErr.Error()
				failures = append(failures, fmt.Errorf("%s: %w", call.ID, modelErr))
				if metadata, ok := model.CodexFailureMetadata(modelErr); ok {
					record.FailureDetails = &metadata
				}
			}
		}
		if err := writeJSON(stem+".result.json", record); err != nil {
			return err
		}
	}
	status := "COMPLETED"
	if len(failures) > 0 {
		status = "COMPLETED_WITH_ERRORS"
	}
	if notRun > 0 {
		status = "INTERRUPTED"
	}
	if err := writeJSON("run.json", map[string]any{
		"kind": "exploratory_fixed_requests", "status": status, "quality_verdict": "NOT_EVALUATED",
		"started_at": started.UTC(), "ended_at": time.Now().UTC(), "elapsed_ms": time.Since(started).Milliseconds(),
		"calls": called, "not_run": notRun, "file_sha256": hashes,
	}); err != nil {
		return err
	}
	return errors.Join(failures...)
}

func fixedResearchRead(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() > 1<<20 {
		return nil, errors.New("research input must be a regular file no larger than 1 MiB")
	}
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if len(raw) > 1<<20 {
		return nil, errors.New("research input exceeds 1 MiB")
	}
	return raw, err
}

func fixedResearchContained(root, path string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("research path must stay inside its declared directory")
	}
	current := root
	for _, part := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		stat, statErr := os.Lstat(current)
		if os.IsNotExist(statErr) {
			continue
		}
		if statErr != nil {
			return statErr
		}
		if stat.Mode()&os.ModeSymlink != 0 {
			return errors.New("research paths cannot use symbolic links")
		}
	}
	return nil
}

func fixedResearchRepositoryRoot(t *testing.T) string {
	t.Helper()
	current, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err = os.Stat(filepath.Join(current, "backend", "go.mod")); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			t.Fatal("cannot locate repository root")
		}
		current = parent
	}
}

func fixedResearchEnvironment(t *testing.T) fixedResearchPlan {
	t.Helper()
	manifest := os.Getenv("ELSELIFE_RESEARCH_MANIFEST")
	if manifest == "" {
		t.Skip("ELSELIFE_RESEARCH_MANIFEST is not set; no research model calls")
	}
	if !filepath.IsAbs(manifest) {
		t.Fatal("ELSELIFE_RESEARCH_MANIFEST must be absolute")
	}
	plan, err := loadFixedResearch(filepath.Join(fixedResearchRepositoryRoot(t), ".validation"), manifest, os.Getenv("ELSELIFE_DEV_CODEX_MODEL"))
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestFixedRequestResearchPreflight(t *testing.T) {
	plan := fixedResearchEnvironment(t)
	t.Logf("Validated %d frozen requests; no model, Rust, or database calls", len(plan.Manifest.Calls))
}

func TestFixedRequestResearchLive(t *testing.T) {
	plan := fixedResearchEnvironment(t)
	output := os.Getenv("ELSELIFE_RESEARCH_OUTPUT_DIR")
	if !filepath.IsAbs(output) {
		t.Fatal("ELSELIFE_RESEARCH_OUTPUT_DIR must be an absolute new directory")
	}
	cliPath := os.Getenv("ELSELIFE_DEV_CODEX_CLI_PATH")
	cli, err := model.NewCodexCLI(cliPath, os.Getenv("ELSELIFE_DEV_CODEX_AUTH_HOME"), plan.Manifest.Model, os.Getenv("ELSELIFE_DEV_CODEX_TEMP_DIR"))
	if err != nil {
		t.Fatal(err)
	}
	cli.Proxy = os.Getenv("ELSELIFE_DEV_CODEX_PROXY")
	f, err := os.Open(cliPath)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	_, readErr := io.Copy(hash, f)
	closeErr := f.Close()
	if err = errors.Join(readErr, closeErr); err != nil {
		t.Fatal(err)
	}
	// Credentials, auth-home contents and proxy values are never read or logged.
	plan.Provider = map[string]string{"adapter": "CodexCLI", "model": cli.Model, "reasoning_effort": cli.ReasoningEffort, "cli_path": cliPath, "cli_sha256": fmt.Sprintf("%x", hash.Sum(nil))}
	if err = runFixedResearch(context.Background(), plan, output, cli); err != nil {
		t.Fatal("research execution retained all available evidence:", err)
	}
	t.Log("Exploratory calls recorded; no product or literary quality verdict")
}
