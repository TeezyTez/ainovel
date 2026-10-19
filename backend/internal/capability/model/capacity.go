package model

// CapacityOK is extracted unchanged from context_limits.go; catalog routing is excluded.
func CapacityOK(contextTokens, outputTokens int, verified bool) bool {
	return verified && outputTokens > 0 && contextTokens > outputTokens && contextTokens <= 2_000_000
}
