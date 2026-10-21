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

-- The selector is derived by Go from the pinned operation. Knowledge is filtered
-- in SQL before any result is counted or paginated for an actor.
-- name: ExperienceMaterialFacts :many
SELECT fact.value::jsonb AS body
FROM experience_pages AS page,
LATERAL jsonb_array_elements(page.state->'facts') AS fact(value)
WHERE page.account_id=sqlc.arg(account_id) AND page.experience_id=sqlc.arg(experience_id)
 AND page.branch_id=sqlc.arg(branch_id) AND page.revision=sqlc.arg(revision)
 AND fact.value->>'id'=ANY(sqlc.arg(fact_ids)::text[])
 AND (sqlc.arg(actor_id)::text='' OR jsonb_exists(fact.value->'known_by',sqlc.arg(actor_id)::text))
ORDER BY fact.value->>'id';

-- Derived records remain private author material; source pages are verified
-- separately before the selected bundle is dispatched to a model.
-- name: ExperienceMaterialMemories :many
SELECT memory.value::jsonb AS body
FROM experience_pages AS page,
LATERAL jsonb_array_elements(COALESCE(page.state->'literary_memory'->'entries','[]'::jsonb)) AS memory(value)
WHERE page.account_id=sqlc.arg(account_id) AND page.experience_id=sqlc.arg(experience_id)
 AND page.branch_id=sqlc.arg(branch_id) AND page.revision=sqlc.arg(revision)
 AND memory.value->>'id'=ANY(sqlc.arg(memory_ids)::text[])
ORDER BY memory.value->>'id';

-- name: ExperienceMaterialSourcePages :many
SELECT revision,page FROM experience_pages
WHERE account_id=sqlc.arg(account_id) AND experience_id=sqlc.arg(experience_id)
 AND branch_id=sqlc.arg(branch_id) AND revision=ANY(sqlc.arg(revisions)::bigint[])
ORDER BY revision;
