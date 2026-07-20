ALTER TABLE note_items
    ADD COLUMN indent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE note_items
    ADD CONSTRAINT note_items_indent_nonnegative CHECK (indent >= 0);
