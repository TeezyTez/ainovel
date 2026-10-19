-- name: ExperienceArtifactHead :one
SELECT artifact_id,revision_id FROM experience_artifact_heads WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3;
-- name: ExperienceArtifactSetHead :exec
INSERT INTO experience_artifact_heads(account_id,experience_id,branch_id,artifact_id,revision_id) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(account_id,experience_id,branch_id) DO UPDATE SET revision_id=EXCLUDED.revision_id;
-- name: ExperienceArtifactVersions :many
SELECT * FROM experience_artifact_versions WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 ORDER BY created_at DESC,id DESC;
-- name: ExperienceArtifactVersion :one
SELECT * FROM experience_artifact_versions WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND id=$4 AND artifact_id=$5;
-- name: ExperienceArtifactInsert :exec
INSERT INTO experience_artifact_versions(account_id,experience_id,branch_id,artifact_id,id,base_revision,payload,local_state,state_revision,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
-- name: ExperienceArtifactState :execrows
UPDATE experience_artifact_versions SET local_state=$6,state_revision=state_revision+1
WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND id=$4 AND state_revision=$5;
-- name: ExperienceArtifactReceipt :one
SELECT digest,result FROM experience_artifact_receipts WHERE account_id=$1 AND request_id=$2;
-- name: ExperienceArtifactSaveReceipt :exec
INSERT INTO experience_artifact_receipts(account_id,request_id,experience_id,branch_id,digest,result) VALUES($1,$2,$3,$4,$5,$6);