-- ElseLife-only authority. No legacy task, payment or memory table is consumed.
CREATE TABLE experiences (
 account_id text NOT NULL, id text NOT NULL, seed text NOT NULL,
 active_branch_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id)
);
CREATE TABLE experience_branches (
 account_id text NOT NULL, experience_id text NOT NULL, id text NOT NULL,
 name text NOT NULL, title text NOT NULL, revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 parent_branch_id text, parent_revision bigint, state jsonb NOT NULL,
 fence bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,experience_id,id),
 FOREIGN KEY(account_id,experience_id) REFERENCES experiences(account_id,id)
);
CREATE TABLE experience_pages (
 account_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), page jsonb NOT NULL, state jsonb NOT NULL,
 title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,experience_id,branch_id,revision),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id)
);
-- Global per-account request IDs cover create/advance and cannot be reused at another path.
CREATE TABLE experience_operations (
 account_id text NOT NULL, request_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 digest text NOT NULL, mode text NOT NULL CHECK(mode IN ('begin','act','read','ask')), input text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','generating','committed','failed','cancelled','interrupted')),
 base_revision bigint NOT NULL, committed_revision bigint, error_code text,
 fence bigint NOT NULL, lease_until timestamptz NOT NULL,
 context jsonb, candidate jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id)
);
CREATE UNIQUE INDEX experience_one_active ON experience_operations(account_id,experience_id,branch_id)
 WHERE status IN ('pending','generating');
CREATE TABLE experience_forks (
 account_id text NOT NULL, request_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 digest text NOT NULL, edit jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id)
);
CREATE TABLE experience_preferences (
 account_id text NOT NULL, dimension text NOT NULL, value text NOT NULL,
 source text NOT NULL CHECK(source IN ('explicit','inferred')), evidence text NOT NULL,
 confirmed boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,dimension)
);
-- Serving uses database.OpenServing: every physical connection holds the existing
-- shared restore gate. Restore owns the exclusive gate and may load these tables.
