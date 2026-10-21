-- Empty development database ONLY. No account/business bootstrap.
BEGIN;
-- 恢复状态不属于业务备份；同库全部角色共享恢复门禁。
CREATE TABLE recovery_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 status text NOT NULL CHECK (status IN ('blocked','verified')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO recovery_gate(singleton,status) VALUES(true,'verified');

-- 每条业务物理连接各自持共享锁；任一断线不会使仍活动的连接脱离恢复互斥。
CREATE FUNCTION acquire_serving_gate() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT pg_try_advisory_lock_shared(716829432::bigint) THEN
  RAISE EXCEPTION 'database_recovery_blocked';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM recovery_gate WHERE singleton AND status='verified') THEN
  PERFORM pg_advisory_unlock_shared(716829432::bigint);
  RAISE EXCEPTION 'database_recovery_blocked';
 END IF;
END;
$$;

-- 业务连接的恢复门只认这一条函数。锁拿不到，或 recovery_gate 不是 verified，都是 QQG01。
-- 不再借用 RAISE 的默认码 P0001：那个码是所有没写 ERRCODE 的异常共用的，按正文分类会误命中。
-- 可重入：CREATE OR REPLACE。

CREATE OR REPLACE FUNCTION acquire_serving_gate() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT pg_try_advisory_lock_shared(716829432::bigint) THEN
  RAISE EXCEPTION 'database_recovery_blocked' USING ERRCODE='QQG01';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM recovery_gate WHERE singleton AND status='verified') THEN
  PERFORM pg_advisory_unlock_shared(716829432::bigint);
  RAISE EXCEPTION 'database_recovery_blocked' USING ERRCODE='QQG01';
 END IF;
END;
$$;

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

-- Exact source retrieval is read-only narrative work. Its receipts and the
-- actual model input are durable audit, never story pages or executable retries.
CREATE TABLE experience_reads (
 account_id text NOT NULL, operation_id text NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
 request_id text NOT NULL, fence bigint NOT NULL, request jsonb NOT NULL, reply jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,operation_id,sequence), UNIQUE(account_id,operation_id,request_id),
 FOREIGN KEY(account_id,operation_id) REFERENCES experience_operations(account_id,request_id) ON DELETE CASCADE
);
CREATE TABLE experience_model_inputs (
 account_id text NOT NULL, operation_id text NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
 fence bigint NOT NULL, context jsonb NOT NULL, model_request bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,operation_id,sequence),
 FOREIGN KEY(account_id,operation_id) REFERENCES experience_operations(account_id,request_id) ON DELETE CASCADE
);

-- Public presentation attachments only. Story pages/state remain unchanged.
CREATE TABLE experience_artifact_heads (
 account_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 artifact_id text NOT NULL, revision_id text NOT NULL,
 PRIMARY KEY(account_id,experience_id,branch_id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id) ON DELETE CASCADE
);
CREATE TABLE experience_artifact_versions (
 account_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 artifact_id text NOT NULL, id text NOT NULL, base_revision bigint NOT NULL CHECK(base_revision>=0),
 payload jsonb NOT NULL, local_state jsonb NOT NULL DEFAULT '{}', state_revision bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,experience_id,branch_id,id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id) ON DELETE CASCADE
);
CREATE TABLE experience_artifact_receipts (
 account_id text NOT NULL, request_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 digest text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id) ON DELETE CASCADE
);
CREATE TABLE experience_gameplay_operations (
 account_id text NOT NULL, request_id text NOT NULL,
 artifact_id text NOT NULL, artifact_revision text NOT NULL, definition_digest text NOT NULL,
 baseline jsonb NOT NULL, replay jsonb NOT NULL, action jsonb NOT NULL, receipt jsonb,
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,request_id) REFERENCES experience_operations(account_id,request_id) ON DELETE CASCADE
);

ALTER TABLE experience_operations ADD COLUMN reading_request text NOT NULL DEFAULT '';
ALTER TABLE experience_operations ADD COLUMN progress_phase text NOT NULL DEFAULT '';
ALTER TABLE experience_operations ADD COLUMN progress_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE experience_operations ADD COLUMN narrative_approval jsonb;
CREATE TABLE experience_narrative_preparations (
 account_id text NOT NULL, experience_id text NOT NULL, branch_id text NOT NULL,
 id text NOT NULL, base_revision bigint NOT NULL CHECK(base_revision>0), base_fence bigint NOT NULL,
 pin text NOT NULL, engine_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('preparing','ready','claimed','stale','failed')),
 lease_until timestamptz NOT NULL,
 candidate jsonb, approval jsonb, audit jsonb NOT NULL DEFAULT '[]', claimed_request_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,experience_id,branch_id,base_revision),
 UNIQUE(account_id,id),
 FOREIGN KEY(account_id,experience_id,branch_id) REFERENCES experience_branches(account_id,experience_id,id) ON DELETE CASCADE
);

COMMIT;
