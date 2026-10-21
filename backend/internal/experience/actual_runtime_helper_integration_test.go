//go:build integration

package experience

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Reading the entire executable regresses the bounded copy required for large
// Rust binaries on Windows-mounted paths. Keep both source construction and
// verification streamed, and measure only the helper's allocation.
func TestActualRuntimeCopyBoundsMemoryAndPreservesExactBytes(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source-runtime"), filepath.Join(dir, "copied-runtime")
	file, err := os.Create(source)
	must(t, err)
	expected := sha256.New()
	writer := io.MultiWriter(file, expected)
	block := []byte(strings.Repeat("runtime bytes \x00\xff", 4096))
	for i := 0; i < 256; i++ {
		_, err := writer.Write(block)
		must(t, err)
	}
	must(t, file.Close())
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	digest, err := copyActualRuntimeBinary(source, target)
	runtime.ReadMemStats(&after)
	must(t, err)
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > 1<<20 {
		t.Errorf("runtime copy allocated %d bytes for a %d-byte file; require bounded streaming", allocated, 256*len(block))
	}
	if digest != fmt.Sprintf("%x", expected.Sum(nil)) {
		t.Fatal("reported executable hash differs from source bytes")
	}
	copied, err := os.Open(target)
	must(t, err)
	defer copied.Close()
	actual := sha256.New()
	n, err := io.Copy(actual, copied)
	must(t, err)
	if n != int64(256*len(block)) || fmt.Sprintf("%x", actual.Sum(nil)) != digest {
		t.Fatal("independent executable copy changed or truncated source bytes")
	}
	t.Logf("streamed runtime copy: bytes=%d allocated=%d sha256=%s", n, after.TotalAlloc-before.TotalAlloc, digest)
}

// Exercise t.Fatal and t.Cleanup in a real subprocess: a subtest failure cannot
// be recovered by its parent. The executable is our own local failing fixture.
func TestActualReadRuntimeReportsEarlyExitWithoutFalseCleanupTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the actual Rust integration harness executes Unix binaries; run in WSL")
	}
	fixture := filepath.Join(t.TempDir(), "failing-runtime")
	must(t, os.WriteFile(fixture, []byte("#!/bin/sh\nprintf '%s\\n' 'runtime-test stdout evidence'\nprintf '%s\\n' 'runtime-test stderr evidence' >&2\nexit 2\n"), 0700))
	binary, err := os.Executable()
	must(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "-test.run=^TestActualReadRuntimeFailureProcessHelper$", "-test.v")
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + t.TempDir(), "ELSELIFE_RUNTIME_FAILURE_HELPER=1", "ELSELIFE_TEST_RUST_RUNTIME=" + fixture}
	output, err := command.CombinedOutput()
	if err == nil || ctx.Err() != nil {
		t.Fatalf("expected a prompt startup failure, got %v / %v: %s", err, ctx.Err(), output)
	}
	for _, evidence := range []string{"exit status 2", "runtime-test stdout evidence", "runtime-test stderr evidence"} {
		if !strings.Contains(string(output), evidence) {
			t.Errorf("startup failure lost %q: %s", evidence, output)
		}
	}
	if strings.Contains(string(output), "runtime failed to exit") {
		t.Errorf("cleanup waited again for an already observed exit: %s", output)
	}
}

func TestActualReadRuntimeFailureProcessHelper(t *testing.T) {
	if os.Getenv("ELSELIFE_RUNTIME_FAILURE_HELPER") != "1" {
		t.Skip("subprocess helper; exercised by TestActualReadRuntimeReportsEarlyExitWithoutFalseCleanupTimeout")
	}
	actualReadRuntime(t)
	t.Fatal("failing runtime unexpectedly became ready")
}
