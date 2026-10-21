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
