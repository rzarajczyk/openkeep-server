ALTER TABLE users
    ADD COLUMN recovery_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE auth_tokens
    ADD COLUMN purpose VARCHAR(16) NOT NULL DEFAULT 'SESSION';

ALTER TABLE auth_tokens
    ADD CONSTRAINT auth_tokens_purpose_valid CHECK (purpose IN ('SESSION', 'RECOVERY'));
