//go:build integration

package experience

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
)

func TestArchiveConcurrentRestoreIsIdempotent(t *testing.T) {
	s, _, _ := testService(t)
	archive := archiveFixture()
	var imports atomic.Int64
	var workers sync.WaitGroup
	for range 6 {
		workers.Go(func() {
			result, err := s.ImportArchive(context.Background(), "concurrent-restore", archive)
			if err != nil {
				t.Error(err)
				return
			}
			imports.Add(int64(len(result.Imported)))
		})
	}
	workers.Wait()
	if imports.Load() != 1 {
		t.Fatalf("restored %d times", imports.Load())
	}
	restored, err := s.ExportArchive(context.Background(), "concurrent-restore")
	must(t, err)
	if len(restored.Experiences) != 1 || len(restored.Experiences[0].Branches[0].Pages) != 1 {
		t.Fatal("partial duplicate restore")
	}
}
