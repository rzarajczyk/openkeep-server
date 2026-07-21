package com.openkeep.api

import org.apache.tika.Tika
import org.slf4j.LoggerFactory
import org.springframework.core.io.InputStreamResource
import org.springframework.http.ContentDisposition
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.util.UUID

@Component
class AttachmentStorage(properties: OpenKeepProperties) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val root: Path = properties.attachment.storageRoot.toAbsolutePath().normalize()
    private val tempRoot: Path = root.resolve(".tmp")

    init {
        Files.createDirectories(tempRoot)
    }

    fun createTempFile(): Path = Files.createTempFile(tempRoot, "upload-", ".tmp")

    fun finalPath(relativePath: String): Path {
        val path = root.resolve(relativePath).normalize()
        if (!path.startsWith(root)) throw IllegalStateException("Unsafe attachment storage path")
        return path
    }

    fun moveIntoPlace(temp: Path, relativePath: String): Path {
        val destination = finalPath(relativePath)
        Files.createDirectories(destination.parent)
        try {
            Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(temp, destination)
        }
        return destination
    }

    fun deleteAfterCommit(relativePaths: Collection<String>) {
        if (relativePaths.isEmpty()) return
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            relativePaths.forEach(::deleteBestEffort)
            return
        }
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() {
                relativePaths.forEach(::deleteBestEffort)
            }
        })
    }

    fun deleteOnRollback(path: Path) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) return
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCompletion(status: Int) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) deleteBestEffort(path)
            }
        })
    }

    fun deleteBestEffort(relativePath: String) = deleteBestEffort(finalPath(relativePath))

    fun deleteBestEffort(path: Path) {
        try {
            Files.deleteIfExists(path)
        } catch (ex: Exception) {
            logger.warn("Could not delete attachment bytes at {}", path, ex)
        }
    }
}

data class StoredAttachment(
    val metadata: AttachmentEntity,
    val path: Path,
)

@Service
class AttachmentService(
    private val userRepository: UserRepository,
    private val noteRepository: NoteRepository,
    private val attachmentRepository: AttachmentRepository,
    private val storage: AttachmentStorage,
    private val markdownService: MarkdownService,
    private val properties: OpenKeepProperties,
) {
    private val tika = Tika()

    @Transactional
    fun upload(userId: Long, noteId: UUID, file: MultipartFile): AttachmentResponse {
        val user = userRepository.findForUpdateById(userId)
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User no longer exists")
        if (!user.enabled) throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User is disabled")
        val note = noteRepository.findByIdAndUserIdAndDeletedAtIsNull(noteId, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "note_not_found", "Note not found")
        val declaredSize = file.size
        val maxSize = properties.attachment.maxFileSize
        if (declaredSize > maxSize) {
            throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large", "File exceeds the configured size limit")
        }

        val temp = storage.createTempFile()
        var finalPath: Path? = null
        try {
            val actualSize = copyWithLimit(file, temp, maxSize)
            val used = attachmentRepository.totalBytesForUser(userId)
            val quota = properties.attachment.perUserQuota
            if (actualSize > quota || used > quota - actualSize) {
                throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "quota_exceeded", "Attachment storage quota exceeded")
            }

            val filename = safeFilename(file.originalFilename)
            val detectedMime = detectMime(temp)
            val id = UUID.randomUUID()
            val relativePath = "$userId/$noteId/$id"
            finalPath = storage.moveIntoPlace(temp, relativePath)
            storage.deleteOnRollback(finalPath)

            val metadata = attachmentRepository.save(
                AttachmentEntity(
                    id = id,
                    noteId = noteId,
                    kind = if (detectedMime in SAFE_INLINE_IMAGE_TYPES) AttachmentKind.IMAGE else AttachmentKind.FILE,
                    originalFilename = filename,
                    storagePath = relativePath,
                    mimeType = detectedMime,
                    sizeBytes = actualSize,
                    createdAt = Instant.now(),
                ),
            )
            note.updatedAt = Instant.now()
            refreshTextContentRendered(note)
            noteRepository.save(note)
            return metadata.toResponse()
        } catch (ex: Exception) {
            storage.deleteBestEffort(finalPath ?: temp)
            throw ex
        }
    }

    @Transactional
    fun importFromPath(userId: Long, noteId: UUID, source: Path, originalFilename: String, createdAt: Instant) {
        val user = userRepository.findForUpdateById(userId)
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User no longer exists")
        if (!user.enabled) throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User is disabled")
        noteRepository.findByIdAndUserIdAndDeletedAtIsNull(noteId, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "note_not_found", "Note not found")

        val temp = storage.createTempFile()
        var finalPath: Path? = null
        try {
            val actualSize = copyPathWithLimit(source, temp, properties.attachment.maxFileSize)
            val used = attachmentRepository.totalBytesForUser(userId)
            val quota = properties.attachment.perUserQuota
            if (actualSize > quota || used > quota - actualSize) {
                throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "quota_exceeded", "Attachment storage quota exceeded")
            }
            val id = UUID.randomUUID()
            val relativePath = "$userId/$noteId/$id"
            finalPath = storage.moveIntoPlace(temp, relativePath)
            storage.deleteOnRollback(finalPath)
            val detectedMime = detectMime(finalPath)
            attachmentRepository.save(
                AttachmentEntity(
                    id = id,
                    noteId = noteId,
                    kind = if (detectedMime in SAFE_INLINE_IMAGE_TYPES) AttachmentKind.IMAGE else AttachmentKind.FILE,
                    originalFilename = safeFilename(originalFilename),
                    storagePath = relativePath,
                    mimeType = detectedMime,
                    sizeBytes = actualSize,
                    createdAt = createdAt,
                ),
            )
        } catch (ex: Exception) {
            storage.deleteBestEffort(finalPath ?: temp)
            throw ex
        }
    }

    @Transactional(readOnly = true)
    fun open(userId: Long, id: UUID): StoredAttachment {
        val metadata = attachmentRepository.findOwned(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "attachment_not_found", "Attachment not found")
        val path = storage.finalPath(metadata.storagePath)
        if (!Files.isRegularFile(path)) {
            throw ApiException(HttpStatus.NOT_FOUND, "attachment_bytes_missing", "Attachment bytes are unavailable")
        }
        return StoredAttachment(metadata, path)
    }

    @Transactional
    fun delete(userId: Long, id: UUID) {
        val metadata = attachmentRepository.findOwned(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "attachment_not_found", "Attachment not found")
        val note = noteRepository.findByIdAndUserIdAndDeletedAtIsNull(metadata.noteId, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "note_not_found", "Note not found")
        attachmentRepository.delete(metadata)
        note.updatedAt = Instant.now()
        refreshTextContentRendered(note)
        noteRepository.save(note)
        storage.deleteAfterCommit(listOf(metadata.storagePath))
    }

    private fun refreshTextContentRendered(note: NoteEntity) {
        if (note.type != NoteType.TEXT) return
        val attachments = attachmentRepository.findAllByNoteIdOrderByCreatedAtAscIdAsc(note.id)
            .map { MarkdownAttachmentRef(it.id, it.originalFilename, it.kind) }
        note.contentRendered = markdownService.render(note.contentRaw, attachments)
    }

    private fun copyWithLimit(file: MultipartFile, temp: Path, maxSize: Long): Long {
        var total = 0L
        file.inputStream.use { input ->
            Files.newOutputStream(temp, StandardOpenOption.TRUNCATE_EXISTING).use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maxSize) {
                        throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large", "File exceeds the configured size limit")
                    }
                    output.write(buffer, 0, read)
                }
            }
        }
        return total
    }

    private fun copyPathWithLimit(source: Path, temp: Path, maxSize: Long): Long {
        var total = 0L
        Files.newInputStream(source).use { input ->
            Files.newOutputStream(temp, StandardOpenOption.TRUNCATE_EXISTING).use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maxSize) {
                        throw ApiException(
                            HttpStatus.PAYLOAD_TOO_LARGE,
                            "file_too_large",
                            "File exceeds the configured size limit",
                        )
                    }
                    output.write(buffer, 0, read)
                }
            }
        }
        return total
    }

    private fun detectMime(path: Path): String = try {
        tika.detect(path).takeIf { it.isNotBlank() } ?: MediaType.APPLICATION_OCTET_STREAM_VALUE
    } catch (_: Exception) {
        MediaType.APPLICATION_OCTET_STREAM_VALUE
    }

    private fun safeFilename(original: String?): String {
        val base = original
            ?.replace('\\', '/')
            ?.substringAfterLast('/')
            ?.filterNot { it.isISOControl() }
            ?.trim()
            ?.take(255)
            .orEmpty()
        return base.ifBlank { "download" }
    }

    private fun AttachmentEntity.toResponse() = AttachmentResponse(
        id = id,
        kind = kind,
        originalFilename = originalFilename,
        mimeType = mimeType,
        sizeBytes = sizeBytes,
        createdAt = createdAt,
        url = "/attachments/$id",
    )

    companion object {
        private val SAFE_INLINE_IMAGE_TYPES = setOf(
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/avif",
            "image/bmp",
        )
    }
}

@RestController
class AttachmentController(private val attachmentService: AttachmentService) {
    @PostMapping("/notes/{noteId}/attachments", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable noteId: UUID,
        @RequestPart("file") file: MultipartFile,
    ): ResponseEntity<AttachmentResponse> {
        val principal = authentication.principal as OpenKeepPrincipal
        return ResponseEntity.status(HttpStatus.CREATED).body(attachmentService.upload(principal.userId, noteId, file))
    }

    @GetMapping("/attachments/{id}")
    fun download(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
    ): ResponseEntity<InputStreamResource> {
        val principal = authentication.principal as OpenKeepPrincipal
        val stored = attachmentService.open(principal.userId, id)
        val disposition = if (stored.metadata.kind == AttachmentKind.IMAGE) {
            ContentDisposition.inline()
        } else {
            ContentDisposition.attachment()
        }.filename(stored.metadata.originalFilename, StandardCharsets.UTF_8).build()
        val mediaType = try {
            MediaType.parseMediaType(stored.metadata.mimeType)
        } catch (_: Exception) {
            MediaType.APPLICATION_OCTET_STREAM
        }
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
            .header("X-Content-Type-Options", "nosniff")
            .contentType(mediaType)
            .contentLength(stored.metadata.sizeBytes)
            .body(InputStreamResource(Files.newInputStream(stored.path)))
    }

    @DeleteMapping("/attachments/{id}")
    fun delete(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
    ): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        attachmentService.delete(principal.userId, id)
        return ResponseEntity.noContent().build()
    }
}
