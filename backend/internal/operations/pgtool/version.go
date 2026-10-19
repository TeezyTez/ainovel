package pgtool

import "strings"

// VersionMajor 读取 initdb --version 里 (PostgreSQL) 后面的主版本。
// 不在整段输出里搜 " 16."，发行版号不能当成数据库版本。
func VersionMajor(output string) (int, bool) {
	const mark = "(PostgreSQL)"
	i := strings.Index(output, mark)
	if i < 0 {
		return 0, false
	}
	rest := strings.TrimSpace(output[i+len(mark):])
	n := 0
	digits := 0
	for _, r := range rest {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
		digits++
		if digits > 4 {
			return 0, false
		}
	}
	if digits == 0 {
		return 0, false
	}
	return n, true
}
