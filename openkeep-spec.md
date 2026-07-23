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
- `id`, `login`, `password_hash`, `enabled`, `role` (`ADMIN` or `USER`), `created_at`, `updated_at`
- The first admin is bootstrapped once from `OPENKEEP_ADMIN_USERNAME` / `OPENKEEP_ADMIN_PASSWORD` when no enabled admin exists
- Additional users are created by an admin in the app (no public signup). Soft-delete sets `enabled=false` and revokes tokens; login remains reserved

### Auth tokens
- `id`, `user_id`, `token_hash` (SHA-256 hex), `expires_at`, `created_at`, `revoked_at`

### Notes
- `id`, `user_id`, `type` (`TEXT` or `LIST`), `title`, `content_raw`, `content_rendered`, `background_color`
- `is_archived`, `is_pinned`, `created_at`, `updated_at`, `version` (optimistic concurrency), `deleted_at` (soft delete)

### Note Items (for list notes)
- `id`, `note_id`, `text`, `checked`, `sort_order`, `indent`
- `indent` is an integer nesting level (**0–5**). Server and client normalize so the first item is always `0`, and each following item is at most one deeper than the previous item.
- API responses include `textRendered`: sanitized inline HTML derived from `text` (bold, italic, inline code, links, bare URLs, strikethrough). Not stored in the database.

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
- `GET /me` — `{ id, login, role }`
- `PATCH /me/password` — `{ currentPassword, newPassword }`; revokes all of the caller’s tokens
- `GET /users` — admin only; enabled users
- `POST /users` — admin only; create a `USER` with `{ login, password }`
- `DELETE /users/:id` — admin only; soft-delete (cannot delete self or admin)
- `POST /users/:id/reset-password` — admin only; `{ newPassword }` (cannot reset self; use settings)
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
- `POST /markdown/preview` — renders markdown to sanitized HTML for the editor. Body: `{ markdown, attachments?, inline? }`. When `inline` is `false`/omitted (text notes), uses the full CommonMark pipeline (autolink, GFM strikethrough, images, headings, lists, code blocks, underline via `<u>`, horizontal rules). When `inline` is `true` (list items), uses the inline-only subset and returns unwrapped inline HTML (no block elements).

Note create/update payloads include `pinned`, `labels`, checklist `items` (with `indent`), and the usual title/body/color/archive fields. Search stays intentionally simple: PostgreSQL `ILIKE` over note title, body, and list item text, limited to the authenticated user. On create/update, the server stores canonical note state and returns the full saved note (including `contentRendered` / item `textRendered`), so clients can immediately replace local state after autosave.

## Web Client

### Layout and browsing

- Left nav: **Notes** and **Archive**. Under **Notes**, every known label appears as a subitem; selecting a label filters the board to notes that carry that label (case-insensitive). Creating a note while a label is selected seeds that label on the new note. **Archive** clears the label filter.
- When any visible notes are pinned, the board splits into **Pinned** then **Others** sections (headings omitted when nothing is pinned).
- Notes use a Keep-style **masonry** board: cards are packed into equal-width columns by repeatedly placing the next note into the **shortest column** (leftmost on ties). That fills left-to-right across the first row, then packs tightly under shorter cards — not CSS `column-count` top-to-bottom fill, and not row-aligned CSS grid.
- Column count by viewport width: 1 (<560px), 2 (≥560px), 4 (≥1050px), 6 (≥1500px).
- Search sits in the top bar, filters the current user’s notes only, and updates results quickly without advanced operators.

### Note cards

Each card shows the title when present (empty titles are omitted — no “Untitled note” placeholder), rendered body or checklist preview (respecting indent), background color, detected links, labels, pin indicator when pinned, and attachment previews. Clicking anywhere on the card opens the editor. Archive and overflow menu controls, in-note links, and attachment download buttons keep their own click behavior and do not open the note.

- **Text notes:** CommonMark markdown body (plus autolink, GFM strikethrough, underline via `<u>`, horizontal rules, and images) rendered from `contentRendered` on the card. Images may use `http(s)` URLs or an attachment filename on the same note (resolved to `/attachments/{id}`). Attachment images are loaded via authenticated blob URLs in the client. Editor preview/formatting behavior is described under *Creating and editing notes*.
- **List notes:** checklist preview (up to eight items), with visual indent and strikethrough when checked. Item text uses server `textRendered` for the **inline-only** markdown subset: bold, italic, inline code, markdown links, bare URLs, and strikethrough (no headings, lists, images, or block elements in item text). Editor preview/formatting behavior is described under *Creating and editing notes*.
- **Image attachments:** inline preview on the card; a download icon saves the full-size original file.
- **File attachments:** filename, size, and download action.
- **Background colors:** Google Keep palette — Default (`#ffffff`), Red (`#f28b82`), Orange (`#fbbc04`), Yellow (`#fff475`), Green (`#ccff90`), Teal (`#a7ffeb`), Blue (`#cbf0f8`), Dark blue (`#aecbfa`), Purple (`#d7aefb`), Pink (`#fdcfe8`), Brown (`#e6c9a8`), Gray (`#e8eaed`).

### Creating and editing notes

- **Add note** creates a new text note and opens the editor.
- While editing, **Add checkboxes** (toolbar icon) converts a text note into a checklist, splitting non-empty lines into items. **Remove checkboxes** converts back to text, joining item lines with newlines.
- Editing happens in a modal with autosave after a short debounce and optimistic UI. Local edits clear `contentRendered` / item `textRendered` so the masonry board shows the live draft until the save response restores server-rendered HTML.
- Icon controls use an instant custom **Tooltip** (not native `title`), portaled into the open `<dialog>` so bubbles appear above the modal top layer. Used for close, pin, color, checkboxes, attach, Markdown, Formatting, archive/restore, delete, checklist actions, formatting menu items, color swatches, and attachment actions.
- **Editor footer toolbar (left → right):** pin · separator · color palette · add/remove checkboxes · attach file · **M** (Markdown preview toggle) · **A** (Formatting, plain-edit mode only). Right side: archive/restore · delete.
- **Color palette:** a palette icon opens a horizontal popup of round Keep swatches (default shows a no-fill affordance); colors are not shown as a permanent strip in the modal.
- **Markdown / Formatting:**
  - Both TEXT and LIST notes default to a **read-only Markdown preview**. **M** toggles between preview and plain-text editing.
  - In plain mode, **A** (underlined glyph) opens a horizontal **Formatting** menu of icon-only buttons with tooltips (no visible text labels).
  - **TEXT** Formatting inserts full markdown: Heading 1 / Heading 2 / Normal text / Code block · Bold / Italic / Underline / Strikethrough · Ordered / Unordered list · Horizontal line. Preview HTML comes from `POST /markdown/preview`.
  - **LIST** Formatting is limited to the inline subset: Bold / Italic / Strikethrough / Inline code. Preview HTML comes from `POST /markdown/preview` with `inline: true`. In preview, item text is rendered read-only; checkboxes remain interactive; add/delete item controls appear in plain mode.
- **Labels** appear as chips with an × to remove. A **+** chip opens a menu of all labels known from the user’s notes (plus labels created in-session), with checkmarks to toggle membership, and a field to create a new label. Duplicates are rejected case-insensitively.
- **Checklist items** support vertical drag-and-drop reorder via a left-side grip handle, plus horizontal drag (or the grip-handle menu: Move up/down, Indent, Deindent) for nesting within the indent rules above.
- Closing a **new** note with no title, body, checklist text, or attachments discards it (cancel). No empty note is left behind. Notes that already contain content save normally on close.
- Attachments can be uploaded from the editor; images and files can be downloaded or deleted there. Uploading or deleting an attachment on a TEXT note re-renders `contentRendered` so markdown images that reference attachment filenames stay in sync.
- **User settings** (all users) and **Manage users** (admin only) are available from the signed-in user menu, alongside **Import from Google Keep**.
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
