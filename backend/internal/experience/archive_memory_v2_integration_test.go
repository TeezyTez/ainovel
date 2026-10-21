//go:build integration

package experience

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestArchiveMemoryV2ImportExportSelectsStoredVersionWithoutApproval(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	for name, fixture := range map[string]Archive{
		"legacy":      archiveMemoryLegacyFixture(),
		"source_refs": archiveMemorySourceRefsFixture(t),
	} {
		t.Run(name, func(t *testing.T) {
			raw, err := json.Marshal(fixture)
			must(t, err)
			decoded, err := DecodeArchive(raw)
			must(t, err)
			result, err := s.ImportArchive(ctx, name, decoded)
			must(t, err)
			if len(result.Imported) != 1 || len(result.Skipped) != 0 {
				t.Fatalf("import did not restore exactly one experience: %+v", result)
			}
			exported, err := s.ExportArchive(ctx, name)
			must(t, err)
			if exported.Version != fixture.Version {
				t.Fatalf("export version=%d, want stored representation version=%d", exported.Version, fixture.Version)
			}
			// Export reconstructs public projections from the existing private
			// snapshots. It must not grant a live narrative approval or rewrite
			// either source format while doing so.
			for i := range fixture.Experiences[0].Branches[0].Pages {
				page := &fixture.Experiences[0].Branches[0].Pages[i]
				page.Page.Reader = ProjectReader(page.State, page.Page.Revision)
			}
			// PostgreSQL timestamptz preserves the instant, not time.Location.
			// Normalize only SQL timestamp fields. Page JSON, state and evidence
			// remain subject to exact value comparison below.
			archiveDatabaseTimesUTC(&fixture)
			archiveDatabaseTimesUTC(&exported)
			if !reflect.DeepEqual(fixture, exported) {
				expectedRaw, _ := json.Marshal(fixture)
				actualRaw, _ := json.Marshal(exported)
				t.Logf("expected archive: %s", expectedRaw)
				t.Logf("actual archive: %s", actualRaw)
				t.Fatal("archive round trip changed prose, private state, source refs, or legacy evidence")
			}
			again, err := json.Marshal(exported)
			must(t, err)
			if _, err := DecodeArchive(again); err != nil {
				t.Fatalf("exported archive cannot be read: %v", err)
			}
		})
	}
}

func archiveDatabaseTimesUTC(archive *Archive) {
	for ei := range archive.Experiences {
		experience := &archive.Experiences[ei]
		experience.CreatedAt = experience.CreatedAt.UTC()
		for bi := range experience.Branches {
			branch := &experience.Branches[bi]
			branch.CreatedAt = branch.CreatedAt.UTC()
			for pi := range branch.Pages {
				branch.Pages[pi].CreatedAt = branch.Pages[pi].CreatedAt.UTC()
			}
		}
	}
}
