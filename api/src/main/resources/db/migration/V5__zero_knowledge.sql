-- Breaking cutover to zero-knowledge storage. Dev-only: intentional data loss.
DELETE FROM note_labels;
DELETE FROM attachments;
DELETE FROM note_items;
DELETE FROM notes;
DELETE FROM labels;
DELETE FROM import_jobs;

ALTER TABLE users ADD COLUMN kdf_salt BYTEA;
ALTER TABLE users ADD COLUMN kdf_params TEXT;
ALTER TABLE users ADD COLUMN wrapped_vault_key BYTEA;
ALTER TABLE users ADD COLUMN wrapped_vault_key_recovery BYTEA;
ALTER TABLE users ADD COLUMN vault_initialized_at TIMESTAMPTZ;

ALTER TABLE notes DROP COLUMN title;
ALTER TABLE notes DROP COLUMN content_raw;
ALTER TABLE notes DROP COLUMN content_rendered;
ALTER TABLE notes ADD COLUMN wrapped_note_key BYTEA NOT NULL;
ALTER TABLE notes ADD COLUMN ciphertext BYTEA NOT NULL;

DROP TABLE note_items;

ALTER TABLE labels DROP CONSTRAINT labels_user_id_name_key;
ALTER TABLE labels DROP CONSTRAINT labels_name_nonblank;
ALTER TABLE labels DROP COLUMN name;
ALTER TABLE labels ADD COLUMN ciphertext BYTEA NOT NULL;

ALTER TABLE attachments DROP CONSTRAINT attachments_kind_valid;
ALTER TABLE attachments DROP CONSTRAINT attachments_filename_nonblank;
ALTER TABLE attachments DROP COLUMN kind;
ALTER TABLE attachments DROP COLUMN original_filename;
ALTER TABLE attachments DROP COLUMN mime_type;
ALTER TABLE attachments ADD COLUMN meta_ciphertext BYTEA NOT NULL;
