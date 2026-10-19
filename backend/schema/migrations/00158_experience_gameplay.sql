CREATE TABLE experience_gameplay_operations (
 account_id text NOT NULL, request_id text NOT NULL,
 artifact_id text NOT NULL, artifact_revision text NOT NULL, definition_digest text NOT NULL,
 baseline jsonb NOT NULL, replay jsonb NOT NULL, action jsonb NOT NULL, receipt jsonb,
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,request_id) REFERENCES experience_operations(account_id,request_id) ON DELETE CASCADE
);
