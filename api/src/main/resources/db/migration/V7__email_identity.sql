-- Canonical account identity is email (renamed from login).
ALTER TABLE users RENAME COLUMN login TO email;
ALTER TABLE users RENAME CONSTRAINT users_login_nonblank TO users_email_nonblank;

-- Drop the old unique constraint/index on login if present (name varies by PG version).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_login_key;
DROP INDEX IF EXISTS users_login_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (lower(email));

ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ NULL;

CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at TIMESTAMPTZ NULL,
    CONSTRAINT email_verification_tokens_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX email_verification_tokens_hash_uidx ON email_verification_tokens (token_hash);
CREATE INDEX email_verification_tokens_user_id_idx ON email_verification_tokens (user_id);
CREATE INDEX email_verification_tokens_active_idx
    ON email_verification_tokens (user_id, expires_at)
    WHERE consumed_at IS NULL;
