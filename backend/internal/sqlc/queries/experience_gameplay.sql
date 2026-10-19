-- name: ExperienceGameplayOperation :one
SELECT * FROM experience_gameplay_operations WHERE account_id=$1 AND request_id=$2;
-- name: ExperienceGameplayCreate :exec
INSERT INTO experience_gameplay_operations(account_id,request_id,artifact_id,artifact_revision,definition_digest,baseline,replay,action) VALUES($1,$2,$3,$4,$5,$6,$7,$8);
-- name: ExperienceGameplayReceipt :exec
UPDATE experience_gameplay_operations SET receipt=$3 WHERE account_id=$1 AND request_id=$2;
