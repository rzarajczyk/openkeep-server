package com.openkeep.api

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
    private val properties: OpenKeepProperties,
) {
    @Transactional
    fun upload(
        userId: Long,
        noteId: UUID,
        file: MultipartFile,
        metaCiphertextBase64: String,
        attachmentId: UUID? = null,
    ): AttachmentResponse {
        val user = userRepository.findForUpdateById(userId)
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User no longer exists")
        if (!user.enabled) throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User is disabled")
        val note = noteRepository.findByIdAndUserIdAndDeletedAtIsNull(noteId, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "note_not_found", "Note not found")
        val metaCiphertext = CryptoSupport.decodeRequired(
            metaCiphertextBase64,
            "metaCiphertext",
            minBytes = 28,
            maxBytes = 16_384,
        )
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

            val id = attachmentId ?: UUID.randomUUID()
            if (attachmentId != null && attachmentRepository.existsById(id)) {
                throw ApiException(HttpStatus.CONFLICT, "attachment_exists", "An attachment with this id already exists")
            }
            val relativePath = "$userId/$noteId/$id"
            finalPath = storage.moveIntoPlace(temp, relativePath)
            storage.deleteOnRollback(finalPath)

            val metadata = attachmentRepository.save(
                AttachmentEntity(
                    id = id,
                    noteId = noteId,
                    storagePath = relativePath,
                    metaCiphertext = metaCiphertext,
                    sizeBytes = actualSize,
                    createdAt = Instant.now(),
                ),
            )
            note.updatedAt = Instant.now()
            noteRepository.save(note)
            return metadata.toResponse()
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
        noteRepository.save(note)
        storage.deleteAfterCommit(listOf(metadata.storagePath))
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

    private fun AttachmentEntity.toResponse() = AttachmentResponse(
        id = id,
        metaCiphertext = CryptoSupport.encode(metaCiphertext),
        sizeBytes = sizeBytes,
        createdAt = createdAt,
        url = "/attachments/$id",
    )
}

@RestController
class AttachmentController(private val attachmentService: AttachmentService) {
    @PostMapping("/notes/{noteId}/attachments", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable noteId: UUID,
        @RequestPart("file") file: MultipartFile,
        @RequestPart("metaCiphertext") metaCiphertext: String,
        @RequestPart(name = "attachmentId", required = false) attachmentId: String?,
    ): ResponseEntity<AttachmentResponse> {
        val principal = authentication.principal as OpenKeepPrincipal
        val parsedId = attachmentId?.let {
            try {
                UUID.fromString(it.trim())
            } catch (_: IllegalArgumentException) {
                throw ApiException(HttpStatus.BAD_REQUEST, "invalid_attachment_id", "attachmentId must be a UUID")
            }
        }
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(attachmentService.upload(principal.userId, noteId, file, metaCiphertext, parsedId))
    }

    @GetMapping("/attachments/{id}")
    fun download(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
    ): ResponseEntity<InputStreamResource> {
        val principal = authentication.principal as OpenKeepPrincipal
        val stored = attachmentService.open(principal.userId, id)
        val disposition = ContentDisposition.attachment()
            .filename("attachment.bin", StandardCharsets.UTF_8)
            .build()
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
            .header("X-Content-Type-Options", "nosniff")
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
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
