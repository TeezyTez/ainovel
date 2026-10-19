-- name: ExperienceArchiveList :many
SELECT * FROM experiences WHERE account_id=$1 ORDER BY created_at,id LIMIT 1001;

-- name: ExperienceArchiveBranches :many
SELECT * FROM experience_branches WHERE account_id=$1 AND experience_id=$2 ORDER BY created_at,id LIMIT 513;

-- name: ExperienceArchivePages :many
SELECT * FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 ORDER BY revision LIMIT 100001;

-- name: ExperienceDeleteLockBranches :many
SELECT * FROM experience_branches WHERE account_id=$1 AND experience_id=$2 ORDER BY id FOR UPDATE;

-- name: ExperienceDeleteForks :exec
DELETE FROM experience_forks WHERE account_id=$1 AND experience_id=$2;

-- name: ExperienceDeleteOperations :exec
DELETE FROM experience_operations WHERE account_id=$1 AND experience_id=$2;

-- name: ExperienceDeletePages :exec
DELETE FROM experience_pages WHERE account_id=$1 AND experience_id=$2;

-- name: ExperienceDeleteBranches :exec
DELETE FROM experience_branches WHERE account_id=$1 AND experience_id=$2;

-- name: ExperienceDelete :exec
DELETE FROM experiences WHERE account_id=$1 AND id=$2;

-- name: ExperienceArchiveCreate :execrows
INSERT INTO experiences(account_id,id,seed,active_branch_id,created_at)
VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,id) DO NOTHING;

-- name: ExperienceArchiveBranchCreate :exec
INSERT INTO experience_branches(account_id,experience_id,id,name,title,revision,parent_branch_id,parent_revision,state,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);

-- name: ExperienceArchivePageCreate :exec
INSERT INTO experience_pages(account_id,experience_id,branch_id,revision,page,state,title,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8);
