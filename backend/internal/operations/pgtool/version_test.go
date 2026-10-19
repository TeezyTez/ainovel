package pgtool

import "testing"

func TestVersionMajorIsTheNumberAfterPostgreSQL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		out   string
		major int
		ok    bool
	}{
		{"initdb (PostgreSQL) 16.4", 16, true},
		{"initdb (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+1)", 16, true},
		{"initdb (PostgreSQL) 15.4 (Debian 16.1-1.pgdg120+1)", 15, true},
		{"initdb (PostgreSQL) 17beta1", 17, true},
		{"initdb (PostgreSQL) 160.1", 160, true},
		{"initdb (PostgreSQL) 16", 16, true},
		{"PostgreSQL) 16.", 0, false},
		{"", 0, false},
	}
	for _, tc := range cases {
		got, ok := VersionMajor(tc.out)
		if ok != tc.ok || got != tc.major {
			t.Fatalf("%q -> %d %v，要 %d %v", tc.out, got, ok, tc.major, tc.ok)
		}
	}
}
