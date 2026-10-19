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