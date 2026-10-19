-- name: ExperienceBranchChangesGet :one
SELECT edit FROM experience_forks WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 ORDER BY request_id LIMIT 1;

-- name: ExperienceForkPageReplace :exec
UPDATE experience_pages SET page=$5,state=$6,title=$7 WHERE account_id=$1 AND experience_id=$2 AND branch_id=$3 AND revision=$4;