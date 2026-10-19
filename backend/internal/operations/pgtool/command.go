// Package pgtool runs PostgreSQL tools through private service files, preserving libpq TLS options without credentials in argv.
package pgtool

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// Run removes its private connection file on all exits. Tool output is discarded because it can contain database values.
func Run(ctx context.Context, connection, tool string, args ...string) error {
	params, err := parameters(connection)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "telos-pg-service-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	var body strings.Builder
	body.WriteString("[operation]\n")
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := params[key]
		if strings.ContainsAny(key+value, "\r\n\x00") || strings.ContainsAny(key, "[]= \t") {
			return errors.New("pgtool: invalid connection configuration")
		}
		body.WriteString(key + "=" + value + "\n")
	}
	path := filepath.Join(dir, "service.conf")
	if err := os.WriteFile(path, []byte(body.String()), 0600); err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, tool, args...)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "PGSERVICE=") && !strings.HasPrefix(value, "PGSERVICEFILE=") {
			cmd.Env = append(cmd.Env, value)
		}
	}
	cmd.Env = append(cmd.Env, "PGSERVICE=operation", "PGSERVICEFILE="+path)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("pgtool: " + filepath.Base(tool) + " failed")
	}
	return nil
}

// postgresConnURL 只认解析出来的 scheme。postgres:foo 不是 URI；关键字串里的 postgres:// 也不算。
func postgresConnURL(connection string) (*url.URL, bool) {
	u, err := url.Parse(connection)
	if err != nil || u.Opaque != "" {
		return nil, false
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return nil, false
	}
	if !strings.HasPrefix(connection, u.Scheme+"://") {
		return nil, false
	}
	return u, true
}

// databaseName 只收 /name 一段。多一段、空段都不是库名。没有路径则没有库名。
func databaseName(path string) (string, bool) {
	if path == "" || path == "/" {
		return "", true
	}
	if len(path) < 2 || path[0] != '/' || strings.Count(path, "/") != 1 {
		return "", false
	}
	return path[1:], true
}

// parameters accepts URL and libpq keyword syntax, including quoted passwords and Unix sockets.
func parameters(connection string) (map[string]string, error) {
	result := map[string]string{}
	invalid := errors.New("pgtool: invalid connection configuration")
	if u, ok := postgresConnURL(connection); ok {
		if u.User != nil {
			result["user"] = u.User.Username()
			if p, set := u.User.Password(); set {
				result["password"] = p
			}
		}
		if u.Hostname() != "" {
			result["host"] = u.Hostname()
		}
		if u.Port() != "" {
			result["port"] = u.Port()
		}
		name, valid := databaseName(u.Path)
		if !valid {
			return nil, invalid
		}
		if name != "" {
			result["dbname"] = name
		}
		values, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return nil, invalid
		}
		for key, v := range values {
			if len(v) != 1 {
				return nil, invalid
			}
			result[key] = v[0]
		}
		if len(result) == 0 {
			return nil, invalid
		}
		return result, nil
	}
	text := []rune(connection)
	for i := 0; i < len(text); {
		for i < len(text) && unicode.IsSpace(text[i]) {
			i++
		}
		if i == len(text) {
			break
		}
		start := i
		for i < len(text) && text[i] != '=' && !unicode.IsSpace(text[i]) {
			i++
		}
		key := string(text[start:i])
		for i < len(text) && unicode.IsSpace(text[i]) {
			i++
		}
		if key == "" || i == len(text) || text[i] != '=' {
			return nil, invalid
		}
		i++
		for i < len(text) && unicode.IsSpace(text[i]) {
			i++
		}
		quoted := i < len(text) && text[i] == '\''
		if quoted {
			i++
		}
		var value strings.Builder
		closed := !quoted
		for i < len(text) {
			c := text[i]
			i++
			if c == '\\' {
				if i == len(text) {
					return nil, invalid
				}
				value.WriteRune(text[i])
				i++
				continue
			}
			if quoted && c == '\'' {
				closed = true
				break
			}
			if !quoted && unicode.IsSpace(c) {
				break
			}
			value.WriteRune(c)
		}
		if !closed || (quoted && i < len(text) && !unicode.IsSpace(text[i])) {
			return nil, invalid
		}
		result[key] = value.String()
	}
	if len(result) == 0 {
		return nil, invalid
	}
	return result, nil
}
