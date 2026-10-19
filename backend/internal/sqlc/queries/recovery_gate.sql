-- name: AcquireServingConnection :exec
SELECT acquire_serving_gate();

-- name: TryRestoreGate :one
SELECT pg_try_advisory_lock(716829432::bigint)::boolean;

-- name: UnlockServingGate :exec
SELECT pg_advisory_unlock_shared(716829432::bigint);

-- name: UnlockRestoreGate :exec
SELECT pg_advisory_unlock(716829432::bigint);

-- name: BlockRecoveryGate :execrows
UPDATE recovery_gate SET status='blocked',updated_at=now() WHERE singleton=true;

-- name: VerifyRecoveryGate :execrows
UPDATE recovery_gate SET status='verified',updated_at=now() WHERE singleton=true;
