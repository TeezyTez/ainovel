-- name: ExperienceNarrativeProgress :execrows
UPDATE experience_operations SET progress_phase=$4,progress_seq=progress_seq+1,updated_at=now()
WHERE account_id=$1 AND request_id=$2 AND fence=$3 AND status='generating' AND lease_until>clock_timestamp();

-- name: ExperienceNarrativeApproval :execrows
UPDATE experience_operations SET narrative_approval=$4 WHERE account_id=$1 AND request_id=$2 AND fence=$3 AND status='generating' AND lease_until>clock_timestamp();

-- name: ExperienceReadingRequest :execrows
UPDATE experience_operations SET reading_request=$3 WHERE account_id=$1 AND request_id=$2 AND status='pending';

-- name: ExperiencePreparationCreate :one
INSERT INTO experience_narrative_preparations(account_id,experience_id,branch_id,id,base_revision,base_fence,pin,engine_version,status,lease_until)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,'preparing',clock_timestamp()+sqlc.arg(lease_seconds)::int*interval '1 second')
ON CONFLICT(account_id,experience_id,branch_id,base_revision) DO NOTHING RETURNING *;

-- name: ExperiencePreparationGet :one
SELECT * FROM experience_narrative_preparations WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND base_revision=$4;

-- name: ExperiencePreparationByID :one
SELECT * FROM experience_narrative_preparations WHERE account_id=$1 AND id=$2;

-- name: ExperiencePreparationClaimed :one
SELECT * FROM experience_narrative_preparations WHERE account_id=$1 AND claimed_request_id=$2;

-- name: ExperiencePreparationHeartbeat :execrows
UPDATE experience_narrative_preparations SET lease_until=clock_timestamp()+sqlc.arg(lease_seconds)::int*interval '1 second',updated_at=now()
WHERE account_id=$1 AND id=$2 AND status='preparing' AND lease_until>clock_timestamp();

-- name: ExperiencePreparationFinish :execrows
UPDATE experience_narrative_preparations SET status=CASE WHEN sqlc.arg(status)::text='ready' AND claimed_request_id IS NOT NULL THEN 'claimed' ELSE sqlc.arg(status) END,
candidate=sqlc.narg(candidate),approval=sqlc.narg(approval),updated_at=now(),
lease_until=CASE WHEN sqlc.arg(status)::text='ready' THEN clock_timestamp()+interval '20 minutes' ELSE lease_until END
WHERE account_id=$1 AND id=$2 AND status='preparing' AND lease_until>clock_timestamp();

-- name: ExperiencePreparationClaim :execrows
UPDATE experience_narrative_preparations SET status=CASE WHEN status='ready' THEN 'claimed' ELSE status END,claimed_request_id=$3,updated_at=now()
WHERE account_id=$1 AND id=$2 AND status IN ('ready','preparing') AND claimed_request_id IS NULL AND lease_until>clock_timestamp();

-- name: ExperiencePreparationInvalidateExceptClaim :exec
UPDATE experience_narrative_preparations SET status='stale',updated_at=now()
WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND status IN ('preparing','ready')
AND claimed_request_id IS DISTINCT FROM sqlc.arg(keep_request_id)::text;

-- name: ExperiencePreparationInvalidate :exec
UPDATE experience_narrative_preparations SET status='stale',updated_at=now()
WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND status IN ('preparing','ready');

-- name: ExperiencePreparationInvalidateAccount :exec
UPDATE experience_narrative_preparations SET status='stale',updated_at=now()
WHERE account_id=$1 AND status IN ('preparing','ready');

-- name: ExperiencePreparationRecover :exec
UPDATE experience_narrative_preparations SET status='stale',updated_at=now() WHERE status IN ('preparing','ready');

-- name: ExperiencePreparationExpire :exec
UPDATE experience_narrative_preparations SET status='stale',updated_at=now() WHERE status IN ('preparing','ready') AND lease_until<=clock_timestamp();

-- name: ExperiencePreparationAudit :execrows
UPDATE experience_narrative_preparations SET audit=audit||sqlc.arg(entry)::jsonb
WHERE account_id=$1 AND id=$2 AND status='preparing' AND lease_until>clock_timestamp();
