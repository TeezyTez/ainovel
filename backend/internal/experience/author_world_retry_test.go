package experience

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

// These bytes reproduce the old Go DTO field order, independent of the current
// request serializer. The fixed digest was captured for this pre-upgrade body.
const legacyCreateBody = `{"author_world":{"title":"Port","description":"A town","era":"Modern","rules":[],"characters":[],"identity":"Courier","location":"Pier","goal":"","opening":"You reach the pier.","narrative":{"perspective":"第二人称","length":"适中","style":"legacy","pace":"从容"}},"request_id":"legacy-create","seed":"Port story"}`
const legacyCreateDigest = "945eafd4166a6869c24eac797fe657a6854cfd2a15f9fd3d235de43c3c9f6c1a"

func legacyForkBody(branch, request string) string {
	return `{"author_world":{"title":"Port","description":"A town","era":"Modern","rules":[],"characters":[],"identity":"Courier","location":"Pier","goal":"","opening":"You reach the pier.","narrative":{"perspective":"第二人称","length":"适中","style":"legacy","pace":"从容"}},"expected_revision":1,"world_version":{"id":"world","version":2,"title":"Port","public_seed":"Port story"},"request_id":"` + request + `","from_branch_id":"` + branch + `","from_revision":1,"name":"Port version"}`
}

func oldBodyDigest(kind, path, body string) string {
	sum := sha256.Sum256([]byte(kind + ":" + path + ":" + body))
	return hex.EncodeToString(sum[:])
}

func TestLegacyRequestDigestPreservesOldBytesAndEscaping(t *testing.T) {
	for _, tc := range []struct {
		name, style, createDigest, forkDigest string
	}{
		{"ordinary", "legacy", legacyCreateDigest, "6dda7e21bb0c6c3a335b8275909abfa1c7801af7b0d06e2eeef837f7116f71cd"},
		{"empty", "", "5e3be2d8d9df5f538251f50e024150e77366d401f084a7b5ebf9390026098ff5", "c655ee47b2314fbc10cc08237559774308f87df082ff4c877753d4c0092fc287"},
		{"escaped", `quote \" newline\n\u003c\u0026\u003e\u2028`, "c30407f4c502d24d585327975f28c92a1353c142d4cff2035a3b6d075891a930", "3cbb27f89a53311ebea237b2bc2277a7e06f1e5f8019996fdb29ff85b632f660"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var create CreateRequest
			body := strings.Replace(legacyCreateBody, `"style":"legacy"`, `"style":"`+tc.style+`"`, 1)
			if err := StrictJSON([]byte(body), &create); err != nil {
				t.Fatal(err)
			}
			if got := create.legacyDigest(); got != tc.createDigest {
				t.Fatalf("create digest %s, want frozen old digest %s", got, tc.createDigest)
			}
			var fork ForkRequest
			body = strings.Replace(legacyForkBody("branch_old", "legacy-fork"), `"style":"legacy"`, `"style":"`+tc.style+`"`, 1)
			if err := StrictJSON([]byte(body), &fork); err != nil {
				t.Fatal(err)
			}
			if got := fork.legacyDigest("experience-old"); got != tc.forkDigest {
				t.Fatalf("fork digest %s, want frozen old digest %s", got, tc.forkDigest)
			}
			for _, value := range []any{create, fork, create.AuthorWorld, fork.changes()} {
				raw, err := json.Marshal(value)
				if err != nil || strings.Contains(string(raw), `"style"`) {
					t.Fatalf("ordinary serialization retained legacy style: %v", err)
				}
			}
		})
	}
}

func TestCurrentWorldHasNoLegacyDigestFallback(t *testing.T) {
	var request CreateRequest
	body := strings.Replace(legacyCreateBody, `"style":"legacy",`, "", 1)
	if err := StrictJSON([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	if request.legacyDigest() != "" || (ForkRequest{AuthorWorld: request.AuthorWorld}).legacyDigest("experience-old") != "" {
		t.Fatal("current request invented a legacy style for digest comparison")
	}
}
