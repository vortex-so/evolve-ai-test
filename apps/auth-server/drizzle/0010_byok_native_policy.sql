-- Retire active approvals while their connection still carries the legacy
-- project/task policy. Completed and failed history remains unchanged.
UPDATE byok_approval
SET status = CASE
  WHEN status IN ('pending', 'approved') THEN 'rejected'
  WHEN status = 'executing' THEN 'outcome_unknown'
  ELSE status
END
WHERE status IN ('pending', 'approved', 'executing')
  AND connection_id IN (
    SELECT id
    FROM byok_connection
    WHERE CASE
      WHEN json_valid(policy_json) = 0 THEN 1
      WHEN json_type(policy_json, '$.policyVersion') = 'integer'
        AND json_extract(policy_json, '$.policyVersion') = 2 THEN 0
      ELSE 1
    END = 1
  );

-- Native Odoo policies are connection-wide. Legacy policy details cannot be
-- translated safely, so migrate to exact v2 default-deny and require retest.
-- Credential wrapping AAD includes version; neither version nor cipher fields
-- may change in this SQL migration.
UPDATE byok_connection
SET policy_json = '{"policyVersion":2,"enableWrites":false,"allowedSideEffectMethods":[]}',
    tested_version = NULL,
    tested_at = NULL,
    test_status = 'not_tested',
    odoo_uid = NULL
WHERE CASE
  WHEN json_valid(policy_json) = 0 THEN 1
  WHEN json_type(policy_json, '$.policyVersion') = 'integer'
    AND json_extract(policy_json, '$.policyVersion') = 2 THEN 0
  ELSE 1
END = 1;
