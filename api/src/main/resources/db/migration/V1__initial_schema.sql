CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    login VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_login_nonblank CHECK (length(btrim(login)) > 0)
);

CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT auth_tokens_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX auth_tokens_user_id_idx ON auth_tokens(user_id);
CREATE INDEX auth_tokens_active_lookup_idx ON auth_tokens(token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX auth_tokens_cleanup_idx ON auth_tokens(expires_at, revoked_at);

CREATE TABLE notes (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL,
    title VARCHAR(500) NOT NULL DEFAULT '',
    content_raw TEXT NOT NULL DEFAULT '',
    content_rendered TEXT NOT NULL DEFAULT '',
    background_color VARCHAR(32) NOT NULL DEFAULT 'default',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT notes_type_valid CHECK (type IN ('TEXT', 'LIST')),
    CONSTRAINT notes_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE INDEX notes_user_sync_idx ON notes(user_id, updated_at, id);
CREATE INDEX notes_user_active_idx ON notes(user_id, is_archived, updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX notes_deleted_idx ON notes(user_id, deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE note_items (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    checked BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL,
    CONSTRAINT note_items_sort_order_nonnegative CHECK (sort_order >= 0),
    CONSTRAINT note_items_text_length CHECK (length(text) <= 10000),
    UNIQUE(note_id, sort_order)
);

CREATE INDEX note_items_note_id_idx ON note_items(note_id, sort_order, id);

CREATE TABLE attachments (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    kind VARCHAR(10) NOT NULL,
    original_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attachments_kind_valid CHECK (kind IN ('IMAGE', 'FILE')),
    CONSTRAINT attachments_size_nonnegative CHECK (size_bytes >= 0),
    CONSTRAINT attachments_filename_nonblank CHECK (length(btrim(original_filename)) > 0)
);

CREATE INDEX attachments_note_id_idx ON attachments(note_id, created_at, id);
