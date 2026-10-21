//go:build integration && codexlive

package experience

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

const deepReplayMaxSourceDepth = 16

func deepReadReplayFile(dir, name string, limit int64) ([]byte, error) {
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return nil, fmt.Errorf("invalid fixed replay asset %s", name)
	}
	return os.ReadFile(path)
}

func deepReadReplayChain(dir, prefix string, depth int, fixture deepFixture, seen map[string]bool) (*deepReplay, error) {
	if depth > deepReplayMaxSourceDepth {
		return nil, fmt.Errorf("replay ancestry exceeds %d source layers", deepReplayMaxSourceDepth)
	}
	raw, err := deepReadReplayFile(dir, prefix+"events.jsonl", 32<<20)
	if err != nil {
		return nil, err
	}
	rootBytes, err := deepReadReplayFile(dir, prefix+"root.sha256", 128)
	if err != nil {
		return nil, err
	}
	root := string(bytes.TrimSpace(rootBytes))
	if len(root) != 64 || strings.Trim(root, "0123456789abcdef") != "" || seen[root] {
		return nil, fmt.Errorf("invalid or repeated replay ancestor root")
	}
	seen[root] = true
	fixtureBytes, err := deepReadReplayFile(dir, prefix+"fixture.json", 2<<20)
	if err != nil {
		return nil, err
	}
	var recorded deepFixture
	if StrictJSON(fixtureBytes, &recorded) != nil || !reflect.DeepEqual(recorded, fixture) {
		return nil, fmt.Errorf("ancestor fixture differs from requested immutable fixture")
	}
	resumes := 0
	for index, line := range bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'}) {
		var event struct {
			Kind string `json:"kind"`
			Data struct {
				FixtureSHA string `json:"fixture_sha256"`
			} `json:"data"`
		}
		if json.Unmarshal(line, &event) != nil {
			return nil, fmt.Errorf("invalid ancestor event")
		}
		if event.Kind == "resume_manifest" {
			resumes++
		}
		if index == 0 && event.Data.FixtureSHA != "" && event.Data.FixtureSHA != fmt.Sprintf("%x", sha256.Sum256(fixtureBytes)) {
			return nil, fmt.Errorf("ancestor original fixture bytes do not match its manifest")
		}
	}
	if resumes > 1 {
		return nil, fmt.Errorf("duplicate ancestor manifest")
	}
	var source *deepReplay
	if resumes == 1 {
		source, err = deepReadReplayChain(dir, prefix+"source-", depth+1, fixture, seen)
		if err != nil {
			return nil, err
		}
	}
	replay, err := decodeDeepReplayWithSource(raw, root, fixture, source)
	if err != nil {
		return nil, fmt.Errorf("replay layer %d: %w", depth, err)
	}
	replay.sourceFiles = map[string][]byte{
		prefix + "events.jsonl": raw,
		prefix + "root.sha256": rootBytes,
		prefix + "fixture.json": fixtureBytes,
	}
	if source != nil {
		for name, body := range source.sourceFiles {
			replay.sourceFiles[name] = body
		}
	}
	return replay, nil
}

// Copy only fully verified fixed-name transcript/root/fixture bytes. Never copy
// a binary, cache, arbitrary manifest filename, or reconstructed event stream.
func copyDeepReplaySource(directory, caseID, destination string) error {
	if caseID == "" || caseID == "." || filepath.Base(caseID) != caseID || strings.ContainsAny(caseID, `/\`) {
		return fmt.Errorf("invalid replay case ID")
	}
	dir := filepath.Join(directory, caseID)
	raw, err := deepReadReplayFile(dir, "fixture.json", 2<<20)
	if err != nil {
		return err
	}
	var fixture deepFixture
	if StrictJSON(raw, &fixture) != nil || fixture.ID != caseID {
		return fmt.Errorf("invalid source fixture")
	}
	replay, err := deepReadReplayChain(dir, "", 0, fixture, map[string]bool{})
	if err != nil {
		return err
	}
	for name := range replay.sourceFiles {
		if strings.Count(name, "source-") >= deepReplayMaxSourceDepth {
			return fmt.Errorf("copy would exceed source ancestry depth")
		}
		if _, err := os.Lstat(filepath.Join(destination, "source-"+name)); !os.IsNotExist(err) {
			return fmt.Errorf("replay destination already exists or cannot be checked")
		}
	}
	for name, body := range replay.sourceFiles {
		file, err := os.OpenFile(filepath.Join(destination, "source-"+name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, writeErr := file.Write(body)
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func deepValidateSourceReadback(raw json.RawMessage, source *deepReplay) error {
	var data deepRestoredReadback
	if StrictJSON(raw, &data) != nil || source == nil || data.ProjectionMigration != deepProjectionMigration ||
		len(data.StoredPages) != len(source.Pages) || len(data.Snapshots) != len(source.Pages) ||
		!deepReplayViewMatches(data.View, source.Pages) {
		return fmt.Errorf("ancestor independent readback is incomplete or changed")
	}
	if data.TitleBinding != "" && (data.TitleBinding != deepTitleBinding || len(data.StoredTitles) != len(source.Pages) ||
		data.BranchTitle != deepReplayTitle(source.Pages[len(source.Pages)-1])) {
		return fmt.Errorf("ancestor title binding differs")
	}
	for i, prior := range source.Pages {
		if !reflect.DeepEqual(data.StoredPages[i], prior.Page) || data.Snapshots[i].Revision != prior.Page.Revision ||
			!reflect.DeepEqual(data.Snapshots[i].State, prior.State) {
			return fmt.Errorf("ancestor stored original page or snapshot changed")
		}
		if data.TitleBinding != "" && (data.StoredTitles[i].Revision != prior.Page.Revision || data.StoredTitles[i].Title != deepReplayTitle(prior)) {
			return fmt.Errorf("ancestor stored title changed")
		}
	}
	last := data.View.Pages[len(data.View.Pages)-1]
	if last.Reader == nil || !reflect.DeepEqual(data.View.Reader, last.Reader) || !reflect.DeepEqual(data.View.Information, last.Reader.Information) {
		return fmt.Errorf("ancestor public top-level projection differs")
	}
	return nil
}
