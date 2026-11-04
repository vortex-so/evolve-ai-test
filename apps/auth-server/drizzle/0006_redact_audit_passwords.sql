-- Scrub credentials written to audit_log before application-level redaction was added.
-- Each update only touches valid JSON rows where the exact root path already exists,
-- so unrelated audit content remains unchanged and missing keys are not introduced.

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.newPassword', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.newPassword') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.password', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.password') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.currentPassword', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.currentPassword') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.secret', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.secret') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.clientSecret', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.clientSecret') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.client_secret', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.client_secret') IS NOT NULL;

UPDATE audit_log
SET target_snapshot = json_set(target_snapshot, '$.token', '[REDACTED]')
WHERE json_valid(target_snapshot)
  AND json_extract(target_snapshot, '$.token') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.newPassword', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.newPassword') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.password', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.password') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.currentPassword', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.currentPassword') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.secret', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.secret') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.clientSecret', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.clientSecret') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.client_secret', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.client_secret') IS NOT NULL;

UPDATE audit_log
SET metadata = json_set(metadata, '$.token', '[REDACTED]')
WHERE json_valid(metadata)
  AND json_extract(metadata, '$.token') IS NOT NULL;
