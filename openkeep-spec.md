# OpenKeep — Application Specification

Self-hosted, Docker-packaged alternative to Google Keep, with multi-user accounts, notes (text/list), labels, pinning, attachments, Google Keep Takeout import, sync API, and a web client.

## Product Scope

OpenKeep is a multi-user notes app for small self-hosted deployments, packaged with Docker and exposing both a server API and a browser client. Core value: sign in, create notes, optionally turn them into checklists while editing, organize with labels and pins, see them sync automatically, and browse them in a Google Keep-style column layout.

**In scope:** text and checklist notes, checklist item indentation, labels, pin/archive, attachments, full-text-ish search (`ILIKE`), incremental sync, and Google Keep Takeout ZIP import.

**Out of scope for v1:** reminders, note sharing between users, OCR, offline-first sync, and native mobile apps. v1 optimizes for simplicity, predictable storage, and easy deployment.

## Architecture

Three services via Docker Compose:

- **web** — SPA client (React + TypeScript)
- **api** — server (Kotlin + Spring Boot)
- **db** — PostgreSQL

Authentication is sessionless: login returns a bearer token, and every request is scoped to one user account. In Compose deployments, the `web` container proxies `/api` to the API service on the same browser origin.

### Server stack (Kotlin + Spring Boot)

- Spring Web for REST controllers
- Spring Security for token-based auth
- Spring Data JPA (Hibernate) for persistence
- Flyway for schema migrations
- springdoc-openapi for automatic OpenAPI docs
- Multipart config (`spring.servlet.multipart.max-file-size`) tuned to attachment size limits, with streaming upload handling to avoid loading whole files into memory
- Packaged as a single fat JAR in a slim JDK-based Docker image

## Data Model

### Users
- `id`, `login`, `password_hash`, `enabled`, `created_at`, `updated_at`
- Accounts are provisioned from `OPENKEEP_USERS_JSON` (not a public signup UI)

### Auth tokens
- `id`, `user_id`, `token_hash` (SHA-256 hex), `expires_at`, `created_at`, `revoked_at`

### Notes
- `id`, `user_id`, `type` (`TEXT` or `LIST`), `title`, `content_raw`, `content_rendered`, `background_color`
- `is_archived`, `is_pinned`, `created_at`, `updated_at`, `version` (optimistic concurrency), `deleted_at` (soft delete)

### Note Items (for list notes)
- `id`, `note_id`, `text`, `checked`, `sort_order`, `indent`
- `indent` is an integer nesting level (**0–5**). Server and client normalize so the first item is always `0`, and each following item is at most one deeper than the previous item.

### Labels
- `labels`: `id`, `user_id`, `name` (1–500 printable characters, unique per user), `created_at`
- `note_labels`: join table (`note_id`, `label_id`); a note may have at most 100 labels
- Label names on a note are case-insensitive unique from the client’s perspective; the API stores distinct trimmed names

### Attachments

Each note can have zero or more attachments, each either `IMAGE` or `FILE`, distinguished by MIME type at upload time. Images render an inline preview on the card and in the editor, with a download control for the full-size file. Other files show name, size, and icon with a direct download action — never inline rendering.

| Field | Type | Notes |
|---|---|---|
| id | UUID | primary key |
| note_id | UUID | foreign key to notes |
| kind | enum | IMAGE or FILE |
| original_filename | text | shown to user |
| storage_path | text | relative path or object key |
| mime_type | text | detected server-side, not trusted from client |
| size_bytes | bigint | enforced against a max upload size |
| created_at | timestamp | |

Actual bytes are stored on a mounted Docker volume (or S3-compatible object storage for scale), never inside the relational database as blobs — keeps backups fast and queries cheap.

**Validation rules:**
- Max file size (configurable, e.g. 25MB)
- MIME-type sniffing rather than trusting the extension
- Per-user storage quotas to prevent abuse

### Import jobs (Google Keep Takeout)
- `id`, `user_id`, `status` (`VALIDATING` \| `RUNNING` \| `COMPLETED` \| `FAILED`)
- Progress counters: `total_notes`, `processed_notes`, `imported_notes`, `skipped_notes`, `warning_count`
- `warnings_json`, `error_message`, `created_at`, `started_at`, `completed_at`
- Import maps Keep labels and pin state, checklist nesting (`childListItems`) onto `indent` when present, and Keep color enum names (`DEFAULT`, `RED`, `ORANGE`, `YELLOW`, `GREEN`, `TEAL`, `BLUE`, `CERULEAN`, `PURPLE`, `PINK`, `BROWN`, `GRAY`, plus known aliases) onto the matching Keep palette hex values below
- ZIP staging uses a directory under the attachment storage root (`.imports`) unless a dedicated staging root is configured

## API

Core endpoints:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`
- `GET /notes` (supports `updated_after`, `after_id`, `limit`, `archived` for incremental sync)
- `POST /notes`
- `GET /notes/:id`
- `PATCH /notes/:id`
- `DELETE /notes/:id`
- `GET /search?q=...`
- `POST /notes/:id/attachments` (multipart upload)
- `GET /attachments/:id` (streams file; `Content-Disposition: inline` for images, `attachment` for files)
- `DELETE /attachments/:id`
- `POST /imports/google-keep` (multipart Takeout ZIP upload; returns a job)
- `GET /imports/google-keep/:jobId` (job status / result)

Note create/update payloads include `pinned`, `labels`, checklist `items` (with `indent`), and the usual title/body/color/archive fields. Search stays intentionally simple: PostgreSQL `ILIKE` over note title, body, and list item text, limited to the authenticated user. On create/update, the server stores canonical note state and returns the full saved note, so clients can immediately replace local state after autosave.

## Web Client

### Layout and browsing

- Left nav: **Notes** and **Archive**. Under **Notes**, every known label appears as a subitem; selecting a label filters the board to notes that carry that label (case-insensitive). Creating a note while a label is selected seeds that label on the new note. **Archive** clears the label filter.
- When any visible notes are pinned, the board splits into **Pinned** then **Others** sections (headings omitted when nothing is pinned).
- Notes use a Keep-style **masonry** board: cards are packed into equal-width columns by repeatedly placing the next note into the **shortest column** (leftmost on ties). That fills left-to-right across the first row, then packs tightly under shorter cards — not CSS `column-count` top-to-bottom fill, and not row-aligned CSS grid.
- Column count by viewport width: 1 (<560px), 2 (≥560px), 4 (≥1050px), 6 (≥1500px).
- Search sits in the top bar, filters the current user’s notes only, and updates results quickly without advanced operators.

### Note cards

Each card shows the title when present (empty titles are omitted — no “Untitled note” placeholder), rendered body or checklist preview (respecting indent), background color, detected links, labels, pin indicator when pinned, and attachment previews. Clicking anywhere on the card opens the editor. Archive and overflow menu controls, in-note links, and attachment download buttons keep their own click behavior and do not open the note.

- **Text notes:** markdown body rendered as a preview on the card.
- **List notes:** read-only checklist preview (up to eight items), with visual indent.
- **Image attachments:** inline preview on the card; a download icon saves the full-size original file.
- **File attachments:** filename, size, and download action.
- **Background colors:** Google Keep palette — Default (`#ffffff`), Red (`#f28b82`), Orange (`#fbbc04`), Yellow (`#fff475`), Green (`#ccff90`), Teal (`#a7ffeb`), Blue (`#cbf0f8`), Dark blue (`#aecbfa`), Purple (`#d7aefb`), Pink (`#fdcfe8`), Brown (`#e6c9a8`), Gray (`#e8eaed`). The editor color picker uses the same swatches (default shows a no-fill affordance).

### Creating and editing notes

- **Add note** creates a new text note and opens the editor.
- While editing, **Add checkboxes** (toolbar icon) converts a text note into a checklist, splitting non-empty lines into items. **Remove checkboxes** converts back to text, joining item lines with newlines.
- Editing happens in a modal with autosave after a short debounce and optimistic UI. Icon controls expose native `title` tooltips (close, pin, checkboxes, upload, archive/restore, delete, checklist actions, attachment actions).
- **Labels** appear as chips with an × to remove. A **+** chip opens a menu of all labels known from the user’s notes (plus labels created in-session), with checkmarks to toggle membership, and a field to create a new label. Duplicates are rejected case-insensitively.
- **Checklist items** support vertical drag-and-drop reorder via a left-side grip handle, plus horizontal drag (or the grip-handle menu: Move up/down, Indent, Deindent) for nesting within the indent rules above.
- Closing a **new** note with no title, body, checklist text, or attachments discards it (cancel). No empty note is left behind. Notes that already contain content save normally on close.
- Attachments can be uploaded from the editor; images and files can be downloaded or deleted there.
- **Import from Google Keep** is available from the signed-in user menu: upload a Takeout ZIP, poll job progress, and review warnings when import completes.

### Client implementation notes

- React + TypeScript SPA served by the `web` container; `/api` is proxied to the API service in Compose deployments.
- Bearer token stored in browser `localStorage`; session expires per `OPENKEEP_TOKEN_TTL`.

## Database Choice: PostgreSQL vs MongoDB vs Firebase

| Dimension | PostgreSQL | MongoDB | Firebase |
|---|---|---|---|
| Data model fit | Relational — clean fit for users, notes, list items, attachments as related tables | Document — good for flexible/nested note bodies, weaker for strict relations | Managed NoSQL — real-time sync built-in, but rigid query model |
| Transactions/integrity | Full ACID, ideal for multi-user data ownership rules | Weaker consistency guarantees by default | Limited transactional guarantees at scale |
| Self-hosting | Fully self-hostable, matches OpenKeep's self-hosted requirement | Self-hostable, but adds extra ops burden vs Postgres | Cloud-only, Google-managed — breaks the self-hosted goal entirely |
| Search | Built-in `ILIKE`/full-text search sufficient for "simple search" requirement | Text search available but adds complexity for this use case | Requires third-party search add-ons (e.g. Algolia) |
| Attachments | Metadata in relational tables, bytes on disk/object storage — clean separation | Can embed metadata in documents; GridFS for large files adds overhead | Firebase Storage handles files, but ties app fully to Google's stack |
| Vendor lock-in | None — open source, portable | None — open source, portable | High — proprietary APIs and hosting |

**Recommendation: PostgreSQL.** OpenKeep's data is inherently relational (users → notes → list items → attachments), needs ACID guarantees for concurrent multi-device edits, and must run fully self-hosted in Docker — a hard requirement Firebase cannot satisfy since it's a Google-managed cloud service. MongoDB is a reasonable alternative if note content becomes highly unstructured, but for OpenKeep's fixed shape, plain SQL with JSONB for note body is simpler to operate and query than a document store. Firebase is excluded outright — it's cloud-only, introduces vendor lock-in, and directly contradicts the self-hosted requirement.

## Delivery Rules

- Package everything as Docker: `openkeep-web`, `openkeep-api`, and `postgres`, one-command startup via Compose
- Persist DB data in a named volume
- Configure secrets via environment variables
- Expose the app behind a reverse proxy path or domain

**Minimum non-functional rules:**
- Passwords hashed with bcrypt
- All note and attachment access must be user-scoped on the server
- Markdown must be sanitized before rendering
- API documented with OpenAPI at `/openapi.json`
- Health endpoint: `GET /health` (browser path via the web proxy: `/api/health`)
