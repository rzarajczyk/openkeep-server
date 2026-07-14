ALTER TABLE notes
    ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX notes_user_pinned_idx ON notes(user_id, is_pinned, updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE labels (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT labels_name_nonblank CHECK (length(btrim(name)) > 0),
    UNIQUE(user_id, name)
);

CREATE TABLE note_labels (
    id UUID PRIMARY KEY,
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    UNIQUE(note_id, label_id)
);

CREATE INDEX note_labels_note_id_idx ON note_labels(note_id);
CREATE INDEX note_labels_label_id_idx ON note_labels(label_id);

CREATE TABLE import_jobs (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    total_notes INTEGER NOT NULL DEFAULT 0,
    processed_notes INTEGER NOT NULL DEFAULT 0,
    imported_notes INTEGER NOT NULL DEFAULT 0,
    skipped_notes INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT import_jobs_status_valid CHECK (status IN ('VALIDATING', 'RUNNING', 'COMPLETED', 'FAILED')),
    CONSTRAINT import_jobs_counts_nonnegative CHECK (
        total_notes >= 0 AND processed_notes >= 0 AND imported_notes >= 0
        AND skipped_notes >= 0 AND warning_count >= 0
    )
);

CREATE INDEX import_jobs_user_created_idx ON import_jobs(user_id, created_at DESC);
