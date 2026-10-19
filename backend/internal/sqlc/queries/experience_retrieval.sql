-- name: ExperienceSnapshot :one
SELECT state FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND revision=$4;

-- name: ExperienceRawPageRange :many
SELECT revision,page FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3
 AND revision>=sqlc.arg(from_revision) AND revision<=sqlc.arg(to_revision) ORDER BY revision;

-- name: ExperienceReadRecord :exec
INSERT INTO experience_reads(account_id,operation_id,sequence,request_id,fence,request,reply) VALUES($1,$2,$3,$4,$5,$6,$7);

-- name: ExperienceModelInputRecord :exec
INSERT INTO experience_model_inputs(account_id,operation_id,sequence,fence,context,model_request) VALUES($1,$2,$3,$4,$5,$6);

-- name: ExperienceReadAudit :many
SELECT * FROM experience_reads WHERE account_id=$1 AND operation_id=$2 ORDER BY sequence;

-- name: ExperienceModelInputAudit :many
SELECT * FROM experience_model_inputs WHERE account_id=$1 AND operation_id=$2 ORDER BY sequence;
