package experience

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"

	"elselife/backend/internal/sqlc/pgq"
)

func canonicalRawJSON(raw []byte) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var v any
	if err := decoder.Decode(&v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}
func receiptHash(v any) (string, error) {
	raw, err := CanonicalReceiptJSON(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func replyBodyHash(r ReadReply) (string, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return "", err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		return "", err
	}
	delete(fields, "receipt")
	return receiptHash(fields)
}

type readCursor struct {
	query  string
	offset int
}
type sourceReader struct {
	service           *Service
	operation         pgq.ExperienceOperation
	generation        Context
	mu                sync.Mutex
	reads, totalBytes int
	seen              map[string]bool
	cursors           map[string]readCursor
}

func newSourceReader(s *Service, o pgq.ExperienceOperation, g Context) *sourceReader {
	return &sourceReader{service: s, operation: o, generation: g, seen: map[string]bool{}, cursors: map[string]readCursor{}}
}

// Every live use, including AFTER a potentially slow source query, checks the
// actual operation/branch clock and fence. PostgreSQL is the authority, not a
// hash/cursor supplied by the model. This is also called inside the audit txn.
func (r *sourceReader) check(ctx context.Context, q *pgq.Queries) error {
	o := r.operation
	b, err := q.ExperienceBranchLock(ctx, pgq.ExperienceBranchLockParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, ID: o.BranchID})
	if err != nil {
		return err
	}
	current, err := q.ExperienceOperationGet(ctx, pgq.ExperienceOperationGetParams{AccountID: o.AccountID, RequestID: o.RequestID})
	if err != nil {
		return err
	}
	now, err := q.ExperienceDatabaseTime(ctx)
	if err != nil {
		return err
	}
	if current.Status != "generating" || current.Fence != o.Fence || b.Fence != o.Fence || b.Revision != o.BaseRevision || !current.LeaseUntil.After(now) {
		return fail("recall_scope_mismatch")
	}
	return nil
}
func (r *sourceReader) RecordModel(ctx context.Context, view Context, sequence int, request []byte) error {
	raw, err := json.Marshal(view)
	if err != nil {
		return err
	}
	return r.service.transaction(ctx, func(q *pgq.Queries) error {
		if err := r.check(ctx, q); err != nil {
			return err
		}
		return q.ExperienceModelInputRecord(ctx, pgq.ExperienceModelInputRecordParams{AccountID: r.operation.AccountID, OperationID: r.operation.RequestID, Sequence: int32(sequence), Fence: r.operation.Fence, Context: raw, ModelRequest: request})
	})
}
func (r *sourceReader) snapshot(ctx context.Context, q *pgq.Queries, rev int64) (State, error) {
	if rev < 0 || rev > r.operation.BaseRevision {
		return State{}, fail("recall_scope_mismatch")
	}
	if rev == 0 {
		return EmptyState(), nil
	}
	o := r.operation
	raw, err := q.ExperienceSnapshot(ctx, pgq.ExperienceSnapshotParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, Revision: rev})
	if errors.Is(err, sql.ErrNoRows) {
		return State{}, fail("recall_revision_unavailable")
	}
	if err != nil {
		return State{}, err
	}
	var state State
	if json.Unmarshal(raw, &state) != nil {
		return state, fail("recall_revision_unavailable")
	}
	if r.generation.StateCoverage.Audience == "reader" {
		state = ReaderState(state)
	}
	return state, nil
}
func revision(given *int64, base int64) int64 {
	if given != nil {
		return *given
	}
	return base
}
func stateObjects(s State, rev int64) []ReadObject {
	result := []ReadObject{}
	for _, f := range s.Facts {
		raw, _ := json.Marshal(f)
		result = append(result, ReadObject{Type: "fact", AsOfRevision: rev, Body: raw})
	}
	for _, e := range s.Entities {
		raw, _ := json.Marshal(e)
		result = append(result, ReadObject{Type: "entity", AsOfRevision: rev, Body: raw})
	}
	for _, t := range s.Threads {
		raw, _ := json.Marshal(t)
		result = append(result, ReadObject{Type: "thread", AsOfRevision: rev, Body: raw})
	}
	return result
}
func objectID(obj ReadObject) string {
	var v struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(obj.Body, &v)
	return v.ID
}
func selectorMatch(obj ReadObject, s ReadSelector) bool {
	if obj.Type != s.Type {
		return false
	}
	text := ""
	switch obj.Type {
	case "fact":
		var f Fact
		_ = json.Unmarshal(obj.Body, &f)
		text = f.Text
		if s.FactKind != "" && f.Kind != s.FactKind {
			return false
		}
		if s.FromSourceRevision != nil && f.SourceRevision < *s.FromSourceRevision {
			return false
		}
		if s.ToSourceRevision != nil && f.SourceRevision > *s.ToSourceRevision {
			return false
		}
	case "entity":
		var e Entity
		_ = json.Unmarshal(obj.Body, &e)
		text = e.Name + "\n" + e.Description
		if s.Kind == "names" {
			for _, name := range s.Names {
				if e.Name == name {
					return true
				}
			}
			return false
		}
	case "thread":
		var t Thread
		_ = json.Unmarshal(obj.Body, &t)
		text = t.Text
	}
	if len(s.Terms) == 0 {
		return true
	}
	found := 0
	for _, term := range s.Terms {
		if strings.Contains(text, term) {
			found++
		}
	}
	if s.Match == "all" {
		return found == len(s.Terms)
	}
	return found > 0
}
func (r *sourceReader) matches(ctx context.Context, req ReadRequest) ([]ReadObject, []HistoryPage, error) {
	tx, err := r.service.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	q := pgq.New(tx)
	sel := req.Selector
	o := r.operation
	objects, pages := []ReadObject{}, []HistoryPage{}
	if sel.Kind == "pages" {
		from, to := *sel.FromRevision, *sel.ToRevision
		if from > to || to > o.BaseRevision {
			return nil, nil, fail("recall_scope_mismatch")
		}
		rows, err := q.ExperienceRawPageRange(ctx, pgq.ExperienceRawPageRangeParams{AccountID: o.AccountID, ExperienceID: o.ExperienceID, BranchID: o.BranchID, FromRevision: from, ToRevision: to})
		if err != nil {
			return nil, nil, err
		}
		if int64(len(rows)) != to-from+1 {
			return nil, nil, fail("recall_revision_unavailable")
		}
		for _, row := range rows {
			var p Page
			if json.Unmarshal(row.Page, &p) != nil {
				return nil, nil, fail("recall_revision_unavailable")
			}
			pages = append(pages, p.HistoryPage)
		}
	} else if sel.Kind == "objects" {
		snapshots := map[int64][]ReadObject{}
		seen := map[string]bool{}
		for _, target := range sel.Objects {
			rev := revision(target.AtRevision, o.BaseRevision)
			all, ok := snapshots[rev]
			if !ok {
				s, err := r.snapshot(ctx, q, rev)
				if err != nil {
					return nil, nil, err
				}
				all = stateObjects(s, rev)
				snapshots[rev] = all
			}
			for _, obj := range all {
				if obj.Type == target.Type && objectID(obj) == target.ID {
					key := obj.Type + "/" + objectID(obj) + "/" + jsonNumber(rev)
					if !seen[key] {
						objects = append(objects, obj)
						seen[key] = true
					}
				}
			}
		}
	} else {
		rev := revision(sel.AtRevision, o.BaseRevision)
		s, err := r.snapshot(ctx, q, rev)
		if err != nil {
			return nil, nil, err
		}
		for _, obj := range stateObjects(s, rev) {
			if selectorMatch(obj, sel) {
				objects = append(objects, obj)
			}
		}
	}
	sort.Slice(objects, func(i, j int) bool {
		a, b := objects[i], objects[j]
		if a.Type != b.Type {
			return a.Type < b.Type
		}
		if objectID(a) != objectID(b) {
			return objectID(a) < objectID(b)
		}
		return a.AsOfRevision < b.AsOfRevision
	})
	return objects, pages, tx.Commit()
}
func jsonNumber(n int64) string { raw, _ := json.Marshal(n); return string(raw) }
func (r *sourceReader) Read(ctx context.Context, req ReadRequest) (ReadReply, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var empty ReadReply
	raw, _ := json.Marshal(req)
	if validateContract(raw, "read_request") != nil {
		return empty, fail("recall_query_incomplete")
	}
	if req.SourceHandle != r.generation.StateCoverage.SourceHandle {
		return empty, fail("recall_scope_mismatch")
	}
	if r.seen[req.RequestID] {
		return empty, fail("recall_query_incomplete")
	}
	budget := r.generation.ReadBudget
	if r.reads >= budget.MaxReads || req.MaxReplyBytes > budget.MaxReplyBytes || req.MaxReplyBytes > budget.MaxTotalReplyBytes-r.totalBytes {
		return empty, fail("recall_budget_exhausted")
	}
	r.reads++
	r.seen[req.RequestID] = true
	if err := r.service.transaction(ctx, func(q *pgq.Queries) error { return r.check(ctx, q) }); err != nil {
		return empty, err
	}
	pred := req.Selector
	pred.Cursor = ""
	query, err := receiptHash(pred)
	if err != nil {
		return empty, err
	}
	start := 0
	if req.Selector.Cursor != "" {
		cursor, ok := r.cursors[req.Selector.Cursor]
		if !ok || cursor.query != query {
			return empty, fail("recall_scope_mismatch")
		}
		start = cursor.offset
	}
	objects, pages, err := r.matches(ctx, req)
	if err != nil {
		return empty, err
	}
	n := len(objects) + len(pages)
	if start > n {
		return empty, fail("recall_scope_mismatch")
	}
	reply := ReadReply{RequestID: req.RequestID, SourceHandle: req.SourceHandle, ExperienceID: r.operation.ExperienceID, BranchID: r.operation.BranchID, BaseRevision: r.operation.BaseRevision, Audience: r.generation.StateCoverage.Audience, Objects: []ReadObject{}, Pages: []HistoryPage{}, Complete: true, Receipt: ReadReceipt{QuerySHA256: strings.Repeat("0", 64), BodySHA256: strings.Repeat("0", 64)}}
	cursor := newID("cursor_")
	pos := start
	for pos < n {
		if len(objects) > 0 {
			reply.Objects = append(reply.Objects, objects[pos])
		} else {
			reply.Pages = append(reply.Pages, pages[pos])
		}
		pos++
		reply.Complete = pos == n
		reply.NextCursor = nil
		if !reply.Complete {
			reply.NextCursor = &cursor
		}
		encoded, _ := json.Marshal(reply)
		if len(encoded) > req.MaxReplyBytes {
			pos--
			if len(objects) > 0 {
				reply.Objects = reply.Objects[:len(reply.Objects)-1]
			} else {
				reply.Pages = reply.Pages[:len(reply.Pages)-1]
			}
			if pos == start {
				return empty, fail("recall_item_capacity")
			}
			break
		}
	}
	reply.Complete = pos == n
	reply.NextCursor = nil
	if !reply.Complete {
		reply.NextCursor = &cursor
		r.cursors[cursor] = readCursor{query: query, offset: pos}
	}
	reply.Receipt.QuerySHA256, err = receiptHash(req)
	if err != nil {
		return empty, err
	}
	reply.Receipt.BodySHA256, err = replyBodyHash(reply)
	if err != nil {
		return empty, err
	}
	encoded, err := json.Marshal(reply)
	if err != nil {
		return empty, err
	}
	if len(encoded) > req.MaxReplyBytes {
		return empty, fail("recall_item_capacity")
	}
	if len(encoded) > budget.MaxTotalReplyBytes-r.totalBytes {
		return empty, fail("recall_budget_exhausted")
	}
	if err = validateContract(encoded, "read_reply"); err != nil {
		return empty, fail("recall_query_incomplete")
	}
	// Fresh, locked, post-query check; cancellation while reading cannot grant
	// new model work, persist a successful receipt or commit from a stale pin.
	err = r.service.transaction(ctx, func(q *pgq.Queries) error {
		if err := r.check(ctx, q); err != nil {
			return err
		}
		return q.ExperienceReadRecord(ctx, pgq.ExperienceReadRecordParams{AccountID: r.operation.AccountID, OperationID: r.operation.RequestID, Sequence: int32(r.reads), RequestID: req.RequestID, Fence: r.operation.Fence, Request: raw, Reply: encoded})
	})
	if err != nil {
		return empty, err
	}
	r.totalBytes += len(encoded)
	return reply, nil
}
