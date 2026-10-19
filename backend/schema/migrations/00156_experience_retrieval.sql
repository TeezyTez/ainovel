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
