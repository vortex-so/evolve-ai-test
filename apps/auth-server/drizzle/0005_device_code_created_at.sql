-- Better Auth 1.6.25's device-authorization schema does not include createdAt,
-- so inserts leave the console-only deviceCode.createdAt column NULL. Backfill
-- Better Auth's ISO-8601 expiresAt values using the configured 10-minute device
-- code lifetime, then populate future omitted values at the database boundary.

UPDATE deviceCode
SET createdAt = COALESCE(
  CAST((unixepoch(expiresAt) - 600) * 1000 AS INTEGER),
  CAST(unixepoch('subsec') * 1000 AS INTEGER)
)
WHERE createdAt IS NULL;

CREATE TRIGGER IF NOT EXISTS deviceCode_set_created_at
AFTER INSERT ON deviceCode
FOR EACH ROW
WHEN NEW.createdAt IS NULL
BEGIN
  UPDATE deviceCode
  SET createdAt = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE id = NEW.id;
END;
