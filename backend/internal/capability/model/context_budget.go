package model

import (
	"errors"
	"unicode/utf8"
)

var ErrContextLimitUnknown = errors.New("context_limit_unknown")
var ErrContextBudgetExceeded = errors.New("context_budget_exceeded")

// VerifyContextBudget is the policy-free carrier guard shared by legacy and
// world roots. UTF-8 bytes bound tokens ONLY for an explicitly verified byte
// fallback tokenizer. Count every message, role, schema and framing. Native
// schema and JSON fallback are separate attempts, each carrying one schema.
// Reserve the larger fallback's explicit instruction and extra message framing.
// No content is trimmed and no model catalog, account plan or worker is loaded.
func VerifyContextBudget(req Request, limit, reserve int, verified bool) (Request, error) {
	if !verified || limit <= 0 || reserve <= 0 {
		return req, ErrContextLimitUnknown
	}
	total := uint64(reserve) + 256 + uint64(len(req.Schema))
	if len(req.Schema) != 0 {
		total += uint64(len(jsonModeSchemaInstruction) + len("system") + 32)
	}
	for _, message := range req.Messages {
		if !utf8.ValidString(message.Content) || !utf8.ValidString(message.Role) {
			return req, ErrContextBudgetExceeded
		}
		total += uint64(len(message.Content)) + uint64(len(message.Role)) + 32
	}
	if total > uint64(limit) {
		return req, ErrContextBudgetExceeded
	}
	req.MaxOutputTokens = reserve
	req.ContextTokenLimit = limit
	return req, nil
}
