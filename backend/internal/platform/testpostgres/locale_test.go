package testpostgres

import "testing"

// macOS 没有 Linux 的 C.utf8 名称；只改变临时库 locale，编码仍由启动入口固定 UTF8。
func TestInitdbLocale(t *testing.T) {
	for _, test := range []struct {
		platform string
		want     string
	}{
		{platform: "darwin", want: "C"},
		{platform: "linux", want: "C.utf8"},
		{platform: "freebsd", want: "C.utf8"},
	} {
		t.Run(test.platform, func(t *testing.T) {
			if got := initdbLocale(test.platform); got != test.want {
				t.Fatalf("locale=%q，预期 %q", got, test.want)
			}
		})
	}
}
