package com.openkeep.api

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.time.Instant
import java.util.UUID

enum class NoteType { TEXT, LIST }
enum class AttachmentKind { IMAGE, FILE }
enum class ImportJobStatus { VALIDATING, RUNNING, COMPLETED, FAILED }
enum class UserRole { ADMIN, USER }

@Entity
@Table(name = "users")
class UserEntity(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null,
    @Column(nullable = false, unique = true)
    var login: String = "",
    @Column(name = "password_hash", nullable = false)
    var passwordHash: String = "",
    @Column(nullable = false)
    var enabled: Boolean = true,
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var role: UserRole = UserRole.USER,
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)

@Entity
@Table(name = "auth_tokens")
class AuthTokenEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "user_id", nullable = false)
    var userId: Long = 0,
    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    var tokenHash: String = "",
    @Column(name = "expires_at", nullable = false)
    var expiresAt: Instant = Instant.now(),
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
    @Column(name = "revoked_at")
    var revokedAt: Instant? = null,
)

@Entity
@Table(name = "notes")
class NoteEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "user_id", nullable = false)
    var userId: Long = 0,
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var type: NoteType = NoteType.TEXT,
    @Column(nullable = false, length = 500)
    var title: String = "",
    @Column(name = "content_raw", nullable = false, columnDefinition = "text")
    var contentRaw: String = "",
    @Column(name = "content_rendered", nullable = false, columnDefinition = "text")
    var contentRendered: String = "",
    @Column(name = "background_color", nullable = false, length = 32)
    var backgroundColor: String = "default",
    @Column(name = "is_archived", nullable = false)
    var archived: Boolean = false,
    @Column(name = "is_pinned", nullable = false)
    var pinned: Boolean = false,
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
    @Version
    @Column(nullable = false)
    var version: Long = 0,
    @Column(name = "deleted_at")
    var deletedAt: Instant? = null,
)

@Entity
@Table(name = "labels")
class LabelEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "user_id", nullable = false)
    var userId: Long = 0,
    @Column(nullable = false, length = 500)
    var name: String = "",
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "note_labels")
class NoteLabelEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "note_id", nullable = false)
    var noteId: UUID = UUID.randomUUID(),
    @Column(name = "label_id", nullable = false)
    var labelId: UUID = UUID.randomUUID(),
)

@Entity
@Table(name = "note_items")
class NoteItemEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "note_id", nullable = false)
    var noteId: UUID = UUID.randomUUID(),
    @Column(nullable = false, columnDefinition = "text")
    var text: String = "",
    @Column(nullable = false)
    var checked: Boolean = false,
    @Column(name = "sort_order", nullable = false)
    var sortOrder: Int = 0,
    @Column(nullable = false)
    var indent: Int = 0,
)

@Entity
@Table(name = "attachments")
class AttachmentEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "note_id", nullable = false)
    var noteId: UUID = UUID.randomUUID(),
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    var kind: AttachmentKind = AttachmentKind.FILE,
    @Column(name = "original_filename", nullable = false)
    var originalFilename: String = "",
    @Column(name = "storage_path", nullable = false, unique = true)
    var storagePath: String = "",
    @Column(name = "mime_type", nullable = false)
    var mimeType: String = "application/octet-stream",
    @Column(name = "size_bytes", nullable = false)
    var sizeBytes: Long = 0,
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
)

@Entity
@Table(name = "import_jobs")
class ImportJobEntity(
    @Id
    var id: UUID = UUID.randomUUID(),
    @Column(name = "user_id", nullable = false)
    var userId: Long = 0,
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    var status: ImportJobStatus = ImportJobStatus.VALIDATING,
    @Column(name = "total_notes", nullable = false)
    var totalNotes: Int = 0,
    @Column(name = "processed_notes", nullable = false)
    var processedNotes: Int = 0,
    @Column(name = "imported_notes", nullable = false)
    var importedNotes: Int = 0,
    @Column(name = "skipped_notes", nullable = false)
    var skippedNotes: Int = 0,
    @Column(name = "warning_count", nullable = false)
    var warningCount: Int = 0,
    @Column(name = "warnings_json", nullable = false, columnDefinition = "text")
    var warningsJson: String = "[]",
    @Column(name = "error_message", columnDefinition = "text")
    var errorMessage: String? = null,
    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),
    @Column(name = "started_at")
    var startedAt: Instant? = null,
    @Column(name = "completed_at")
    var completedAt: Instant? = null,
)
