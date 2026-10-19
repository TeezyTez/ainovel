-- name: ExperienceRequestLock :exec
SELECT pg_advisory_xact_lock(hashtextextended('experience-request:' || sqlc.arg(account_id)::text || ':' || sqlc.arg(request_id)::text,0));

-- name: ExperienceCreate :exec
INSERT INTO experiences(account_id,id,seed,active_branch_id) VALUES($1,$2,$3,$4);

-- name: ExperienceGet :one
SELECT * FROM experiences WHERE account_id=$1 AND id=$2;

-- name: ExperienceList :many
SELECT * FROM experiences WHERE account_id=$1 ORDER BY created_at DESC,id;

-- name: ExperienceBranchCreate :exec
INSERT INTO experience_branches(account_id,experience_id,id,name,title,revision,parent_branch_id,parent_revision,state)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);

-- name: ExperienceBranchLock :one
SELECT * FROM experience_branches WHERE account_id=$1 AND experience_id=$2 AND id=$3 FOR UPDATE;

-- name: ExperienceBranches :many
SELECT * FROM experience_branches WHERE account_id=$1 AND experience_id=$2 ORDER BY created_at,id;

-- name: ExperienceBranchFence :one
UPDATE experience_branches SET fence=fence+1 WHERE account_id=$1 AND experience_id=$2 AND id=$3 RETURNING fence;

-- name: ExperienceBranchCommit :execrows
UPDATE experience_branches SET revision=revision+1,title=$4,state=$5 WHERE account_id=$1 AND experience_id=$2 AND id=$3 AND revision=$6 AND fence=$7;

-- name: ExperiencePages :many
SELECT * FROM experience_pages WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND revision<=sqlc.arg(through_revision) ORDER BY revision;

-- name: ExperiencePageCreate :exec
INSERT INTO experience_pages(account_id,experience_id,branch_id,revision,page,state,title) VALUES($1,$2,$3,$4,$5,$6,$7);

-- name: ExperiencePagesCopy :exec
INSERT INTO experience_pages(account_id,experience_id,branch_id,revision,page,state,title,created_at)
SELECT p.account_id,p.experience_id,sqlc.arg(new_branch_id)::text,p.revision,p.page,CASE WHEN p.revision=sqlc.arg(through_revision) THEN sqlc.arg(fork_state)::jsonb ELSE p.state END,p.title,p.created_at FROM experience_pages p
WHERE p.account_id=$1 AND p.experience_id=$2 AND p.branch_id=sqlc.arg(from_branch_id) AND p.revision<=sqlc.arg(through_revision);

-- name: ExperienceOperationGet :one
SELECT * FROM experience_operations WHERE account_id=$1 AND request_id=$2;

-- name: ExperienceActive :many
SELECT * FROM experience_operations WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND status IN ('pending','generating');

-- name: ExperienceLatestOperation :many
SELECT * FROM experience_operations WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 ORDER BY created_at DESC,request_id LIMIT 1;

-- name: ExperienceOperationCreate :one
INSERT INTO experience_operations(account_id,request_id,experience_id,branch_id,digest,mode,input,status,base_revision,fence,lease_until)
VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,now()+sqlc.arg(lease_seconds)::int*interval '1 second') RETURNING *;

-- name: ExperienceClaim :one
UPDATE experience_operations SET status='generating',updated_at=now() WHERE account_id=$1 AND request_id=$2 AND status='pending' AND lease_until>now() RETURNING *;

-- name: ExperienceFreezeContext :execrows
UPDATE experience_operations SET context=$3 WHERE account_id=$1 AND request_id=$2 AND status='generating' AND fence=$4 AND lease_until>now();

-- name: ExperienceHeartbeat :execrows
UPDATE experience_operations SET lease_until=now()+sqlc.arg(lease_seconds)::int*interval '1 second',updated_at=now()
WHERE account_id=$1 AND request_id=$2 AND status='generating' AND fence=$3 AND lease_until>now();

-- name: ExperienceFinish :execrows
UPDATE experience_operations SET status=sqlc.arg(status),error_code=sqlc.narg(error_code),updated_at=now(),
committed_revision=sqlc.narg(committed_revision),candidate=sqlc.narg(candidate)
WHERE account_id=$1 AND request_id=$2 AND status IN ('pending','generating') AND fence=$3
AND (sqlc.arg(status)::text <> 'committed' OR lease_until>clock_timestamp());

-- name: ExperienceDatabaseTime :one
SELECT clock_timestamp()::timestamptz;

-- name: ExperienceExpired :many
SELECT * FROM experience_operations WHERE status IN ('pending','generating') AND lease_until<=now() ORDER BY created_at;

-- name: ExperienceForkGet :one
SELECT * FROM experience_forks WHERE account_id=$1 AND request_id=$2;

-- name: ExperienceForkCreate :exec
INSERT INTO experience_forks(account_id,request_id,experience_id,branch_id,digest,edit) VALUES($1,$2,$3,$4,$5,$6);

-- name: ExperiencePreferences :many
SELECT * FROM experience_preferences WHERE account_id=$1 ORDER BY dimension;

-- name: ExperiencePreferencePut :exec
INSERT INTO experience_preferences(account_id,dimension,value,source,evidence,confirmed) VALUES($1,$2,$3,'explicit',$4,true)
ON CONFLICT(account_id,dimension) DO UPDATE SET value=excluded.value,source='explicit',evidence=excluded.evidence,confirmed=true,updated_at=now();

-- name: ExperiencePreferenceDelete :exec
DELETE FROM experience_preferences WHERE account_id=$1 AND dimension=$2;
