package com.openkeep.api

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.scheduling.annotation.Async
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.util.UUID
import java.util.zip.ZipInputStream
import kotlin.io.path.name

data class ImportJobAcceptedResponse(
    val jobId: UUID,
    val status: ImportJobStatus,
    val statusUrl: String,
)

data class ImportJobResponse(
    val jobId: UUID,
    val status: ImportJobStatus,
    val totalNotes: Int,
    val processedNotes: Int,
    val importedNotes: Int,
    val skippedNotes: Int,
    val warningCount: Int,
    val warnings: List<String>,
    val progressPercent: Int,
    val errorMessage: String?,
    val createdAt: Instant,
    val startedAt: Instant?,
    val completedAt: Instant?,
)

data class TakeoutItem(val text: String, val checked: Boolean)
data class TakeoutAttachment(val archivePath: String)
data class TakeoutNote(
    val type: NoteType,
    val title: String,
    val content: String,
    val items: List<TakeoutItem>,
    val color: String,
    val archived: Boolean,
    val pinned: Boolean,
    val trashed: Boolean,
    val labels: List<String>,
    val attachments: List<TakeoutAttachment>,
    val createdAt: Instant,
    val updatedAt: Instant,
    val warnings: List<String>,
)

@Component
class TakeoutNoteParser {
    fun isKeepNote(node: JsonNode): Boolean =
        node.isObject && listOf(
            "title",
            "textContent",
            "listContent",
            "isArchived",
            "isPinned",
            "isTrashed",
            "userEditedTimestampUsec",
            "createdTimestampUsec",
        ).any(node::has)

    fun parse(node: JsonNode): TakeoutNote {
        val warnings = mutableListOf<String>()
        val title = node.path("title").takeIf(JsonNode::isTextual)?.asText().orEmpty().let {
            if (it.length > 500) {
                warnings += "Title exceeded 500 characters and was truncated"
                it.take(500)
            } else {
                it
            }
        }
        val isList = node.path("listContent").isArray
        val items = if (isList) {
            buildList {
                node.path("listContent").forEach { addListItem(it, this, warnings) }
            }
        } else {
            emptyList()
        }
        val rawColor = node.path("color").takeIf(JsonNode::isTextual)?.asText()?.uppercase() ?: "DEFAULT"
        val color = KEEP_COLORS[rawColor] ?: run {
            warnings += "Unknown Keep color '$rawColor' was mapped to white"
            KEEP_COLORS.getValue("DEFAULT")
        }
        val created = timestamp(node.path("createdTimestampUsec"))
        val updated = timestamp(node.path("userEditedTimestampUsec"))
        val fallback = updated ?: created ?: Instant.now()
        val rawLabels = node.path("labels").takeIf(JsonNode::isArray)
            ?.mapNotNull { it.path("name").takeIf(JsonNode::isTextual)?.asText()?.trim() }
            .orEmpty()
        val labels = rawLabels
            .map { it.filterNot(Char::isISOControl).take(500) }
            .filter { it.isNotEmpty() }
            .distinct()
            .take(100)
        if (rawLabels.size > labels.size || rawLabels.zip(labels).any { (raw, clean) -> raw != clean }) {
            warnings += "Invalid, duplicate, or excess label data was omitted"
        }
        val attachments = node.path("attachments").takeIf(JsonNode::isArray)
            ?.mapNotNull {
                val path = it.path("filePath").takeIf(JsonNode::isTextual)?.asText()
                    ?: it.path("name").takeIf(JsonNode::isTextual)?.asText()
                path?.takeIf(String::isNotBlank)?.let(::TakeoutAttachment)
            }
            .orEmpty()
        return TakeoutNote(
            type = if (isList) NoteType.LIST else NoteType.TEXT,
            title = title,
            content = node.path("textContent").takeIf(JsonNode::isTextual)?.asText().orEmpty(),
            items = items,
            color = color,
            archived = node.path("isArchived").asBoolean(false),
            pinned = node.path("isPinned").asBoolean(false),
            trashed = node.path("isTrashed").asBoolean(false),
            labels = labels,
            attachments = attachments,
            createdAt = created ?: fallback,
            updatedAt = updated ?: fallback,
            warnings = warnings,
        )
    }

    private fun addListItem(node: JsonNode, target: MutableList<TakeoutItem>, warnings: MutableList<String>) {
        val text = node.path("text").takeIf(JsonNode::isTextual)?.asText().orEmpty()
        if (text.length > 10_000) warnings += "A checklist item exceeded 10000 characters and was truncated"
        target += TakeoutItem(text.take(10_000), node.path("isChecked").asBoolean(false))
        node.path("childListItems").takeIf(JsonNode::isArray)?.forEach { addListItem(it, target, warnings) }
    }

    private fun timestamp(node: JsonNode): Instant? {
        val micros = when {
            node.isIntegralNumber -> node.asLong()
            node.isTextual -> node.asText().toLongOrNull()
            else -> null
        } ?: return null
        return runCatching { Instant.ofEpochSecond(micros / 1_000_000, (micros % 1_000_000) * 1_000) }.getOrNull()
    }

    companion object {
        private val KEEP_COLORS = mapOf(
            "DEFAULT" to "#ffffff",
            "WHITE" to "#ffffff",
            "RED" to "#fee2e2",
            "CORAL" to "#fee2e2",
            "PINK" to "#fee2e2",
            "BLOSSOM" to "#fee2e2",
            "ORANGE" to "#ffedd5",
            "PEACH" to "#ffedd5",
            "YELLOW" to "#fef3c7",
            "SAND" to "#fef3c7",
            "BROWN" to "#fef3c7",
            "GREEN" to "#dcfce7",
            "TEAL" to "#dcfce7",
            "MINT" to "#dcfce7",
            "SAGE" to "#dcfce7",
            "BLUE" to "#dbeafe",
            "DARK_BLUE" to "#dbeafe",
            "CERULEAN" to "#dbeafe",
            "FOG" to "#dbeafe",
            "PURPLE" to "#ede9fe",
            "DUSK" to "#ede9fe",
            "GRAY" to "#f3f4f6",
            "GREY" to "#f3f4f6",
            "STORM" to "#f3f4f6",
            "CLAY" to "#f3f4f6",
            "CHALK" to "#ffffff",
        )
    }
}

@Service
class TakeoutImportPersistence(
    private val userRepository: UserRepository,
    private val noteRepository: NoteRepository,
    private val noteItemRepository: NoteItemRepository,
    private val labelRepository: LabelRepository,
    private val noteLabelRepository: NoteLabelRepository,
    private val markdownService: MarkdownService,
) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun importNote(userId: Long, note: TakeoutNote): UUID {
        userRepository.findForUpdateById(userId)
            ?: throw ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "User no longer exists")
        val entity = noteRepository.saveAndFlush(
            NoteEntity(
                userId = userId,
                type = note.type,
                title = note.title,
                contentRaw = if (note.type == NoteType.TEXT) note.content else "",
                contentRendered = if (note.type == NoteType.TEXT) markdownService.render(note.content) else "",
                backgroundColor = note.color,
                archived = note.archived,
                pinned = note.pinned,
                createdAt = note.createdAt,
                updatedAt = note.updatedAt,
            ),
        )
        if (note.items.isNotEmpty()) {
            noteItemRepository.saveAll(
                note.items.mapIndexed { index, item ->
                    NoteItemEntity(noteId = entity.id, text = item.text, checked = item.checked, sortOrder = index)
                },
            )
        }
        val existingLabels = if (note.labels.isEmpty()) {
            emptyMap()
        } else {
            labelRepository.findAllByUserIdAndNameIn(userId, note.labels).associateBy { it.name }
        }
        val labels = note.labels.map { existingLabels[it] ?: labelRepository.save(LabelEntity(userId = userId, name = it)) }
        noteLabelRepository.saveAll(labels.map { NoteLabelEntity(noteId = entity.id, labelId = it.id) })
        return entity.id
    }
}

@Service
class ImportJobStateService(
    private val repository: ImportJobRepository,
    private val objectMapper: ObjectMapper,
    private val properties: OpenKeepProperties,
) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun start(id: UUID, total: Int) {
        val job = repository.findById(id).orElseThrow()
        job.status = ImportJobStatus.RUNNING
        job.totalNotes = total
        job.startedAt = Instant.now()
        repository.save(job)
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun progress(id: UUID, imported: Boolean, warningMessages: List<String>) {
        val job = repository.findById(id).orElseThrow()
        job.processedNotes++
        if (imported) job.importedNotes++ else job.skippedNotes++
        job.warningCount += warningMessages.size
        if (warningMessages.isNotEmpty()) {
            val warnings = readWarnings(job).toMutableList()
            warnings += warningMessages.take((properties.takeoutImport.maxWarnings - warnings.size).coerceAtLeast(0))
            job.warningsJson = objectMapper.writeValueAsString(warnings)
        }
        repository.save(job)
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun complete(id: UUID) {
        val job = repository.findById(id).orElseThrow()
        job.status = ImportJobStatus.COMPLETED
        job.completedAt = Instant.now()
        repository.save(job)
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun fail(id: UUID, message: String) {
        val job = repository.findById(id).orElse(null) ?: return
        job.status = ImportJobStatus.FAILED
        job.errorMessage = message.take(1_000)
        job.completedAt = Instant.now()
        repository.save(job)
    }

    fun readWarnings(job: ImportJobEntity): List<String> = runCatching {
        objectMapper.readValue(job.warningsJson, Array<String>::class.java).toList()
    }.getOrDefault(emptyList())
}

@Service
class TakeoutImportWorker(
    private val objectMapper: ObjectMapper,
    private val parser: TakeoutNoteParser,
    private val persistence: TakeoutImportPersistence,
    private val attachmentService: AttachmentService,
    private val state: ImportJobStateService,
    private val properties: OpenKeepProperties,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @Async
    fun run(jobId: UUID, userId: Long, zipPath: Path) {
        val workRoot = zipPath.parent.resolve("contents")
        try {
            val entries = extract(zipPath, workRoot)
            val jsonEntries = entries.filter { path ->
                path.toString().endsWith(".json", ignoreCase = true) &&
                    path.iterator().asSequence().any { it.toString().equals("Keep", ignoreCase = true) }
            }
            val parsed = jsonEntries.mapNotNull { path ->
                runCatching {
                    val node = Files.newInputStream(path).use(objectMapper::readTree)
                    if (parser.isKeepNote(node)) path to parser.parse(node) else null
                }.getOrElse { path to null }
            }
            state.start(jobId, parsed.size)
            parsed.forEach { (jsonPath, note) ->
                if (note == null) {
                    state.progress(jobId, false, listOf("${jsonPath.name}: invalid Keep note JSON"))
                    return@forEach
                }
                val displayName = jsonPath.name
                if (note.trashed) {
                    state.progress(jobId, false, listOf("$displayName: trashed note skipped"))
                    return@forEach
                }
                val warnings = note.warnings.toMutableList()
                val attachmentPaths = note.attachments.mapNotNull { attachment ->
                    resolveAttachment(workRoot, jsonPath.parent, attachment.archivePath)?.let {
                        it to Path.of(attachment.archivePath.replace('\\', '/')).fileName.toString()
                    } ?: run {
                        warnings += "attachment '${attachment.archivePath}' was not found"
                        null
                    }
                }
                runCatching {
                    val noteId = persistence.importNote(userId, note)
                    attachmentPaths.forEach { (path, name) ->
                        runCatching { attachmentService.importFromPath(userId, noteId, path, name, note.updatedAt) }
                            .onFailure {
                                logger.warn("Could not import attachment {} for job {}", name, jobId, it)
                                warnings += "attachment '$name' could not be imported"
                            }
                    }
                }
                    .onSuccess { state.progress(jobId, true, warnings.map { "$displayName: $it" }) }
                    .onFailure { ex ->
                        logger.warn("Could not import Keep note {} for job {}", displayName, jobId, ex)
                        state.progress(jobId, false, (warnings + "note could not be imported").map { "$displayName: $it" })
                    }
            }
            state.complete(jobId)
        } catch (ex: Exception) {
            logger.warn("Google Keep import job {} failed", jobId, ex)
            state.fail(jobId, safeFailureMessage(ex))
        } finally {
            deleteTree(zipPath.parent)
        }
    }

    private fun extract(zipPath: Path, root: Path): List<Path> {
        Files.createDirectories(root)
        val output = mutableListOf<Path>()
        val seen = mutableSetOf<String>()
        var entryCount = 0
        var totalSize = 0L
        ZipInputStream(BufferedInputStream(Files.newInputStream(zipPath))).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                entryCount++
                if (entryCount > properties.takeoutImport.maxEntries) {
                    throw UnsafeArchiveException("Archive contains too many entries")
                }
                val normalizedName = safeArchivePath(if (entry.isDirectory) entry.name.removeSuffix("/") else entry.name)
                if (!seen.add(normalizedName)) throw UnsafeArchiveException("Archive contains duplicate entry names")
                val destination = root.resolve(normalizedName).normalize()
                if (!destination.startsWith(root)) throw UnsafeArchiveException("Archive contains an unsafe path")
                if (entry.isDirectory) {
                    Files.createDirectories(destination)
                } else {
                    Files.createDirectories(destination.parent)
                    var entrySize = 0L
                    BufferedOutputStream(
                        Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE),
                    ).use { out ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = zip.read(buffer)
                            if (read < 0) break
                            entrySize += read
                            totalSize += read
                            if (entrySize > properties.takeoutImport.maxEntrySize) {
                                throw UnsafeArchiveException("Archive entry exceeds the size limit")
                            }
                            if (totalSize > properties.takeoutImport.maxUncompressedSize) {
                                throw UnsafeArchiveException("Archive expands beyond the size limit")
                            }
                            out.write(buffer, 0, read)
                        }
                    }
                    output.add(destination)
                }
                zip.closeEntry()
            }
        }
        if (entryCount == 0) throw UnsafeArchiveException("Archive is empty")
        return output
    }

    private fun safeArchivePath(name: String): String {
        if (name.isBlank() || name.indexOf('\u0000') >= 0 || '\\' in name || name.startsWith('/') ||
            Regex("^[A-Za-z]:").containsMatchIn(name)
        ) {
            throw UnsafeArchiveException("Archive contains an unsafe path")
        }
        val parts = name.split('/')
        if (parts.any { it == ".." || it == "." || it.isEmpty() }) {
            throw UnsafeArchiveException("Archive contains an unsafe path")
        }
        return parts.joinToString("/")
    }

    private fun resolveAttachment(root: Path, jsonParent: Path, reference: String): Path? {
        val normalizedReference = runCatching { safeArchivePath(reference.replace('\\', '/')) }.getOrNull() ?: return null
        val candidates = listOf(jsonParent.resolve(normalizedReference), root.resolve(normalizedReference))
        return candidates.map(Path::normalize).firstOrNull { it.startsWith(root) && Files.isRegularFile(it) }
    }

    private fun safeFailureMessage(ex: Exception): String = when (ex) {
        is UnsafeArchiveException -> ex.message ?: "Unsafe or invalid ZIP archive"
        else -> "The archive could not be imported"
    }

    private fun deleteTree(root: Path) {
        if (!Files.exists(root)) return
        runCatching {
            Files.walk(root).use { paths ->
                paths.sorted(Comparator.reverseOrder()).forEach(Files::deleteIfExists)
            }
        }.onFailure { logger.warn("Could not clean import staging directory {}", root, it) }
    }
}

class UnsafeArchiveException(message: String) : RuntimeException(message)

@Service
class TakeoutImportService(
    private val repository: ImportJobRepository,
    private val state: ImportJobStateService,
    private val worker: TakeoutImportWorker,
    private val properties: OpenKeepProperties,
) {
    init {
        Files.createDirectories(properties.takeoutImport.stagingRoot.toAbsolutePath().normalize())
    }

    fun submit(userId: Long, file: MultipartFile): ImportJobAcceptedResponse {
        if (file.isEmpty) throw ApiException(HttpStatus.BAD_REQUEST, "empty_archive", "ZIP archive is empty")
        if (file.size > properties.takeoutImport.maxUploadSize) {
            throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "archive_too_large", "ZIP archive exceeds the size limit")
        }
        val job = repository.save(ImportJobEntity(userId = userId))
        val directory = properties.takeoutImport.stagingRoot.toAbsolutePath().normalize().resolve(job.id.toString())
        val zipPath = directory.resolve("takeout.zip")
        try {
            Files.createDirectories(directory)
            copyUpload(file, zipPath)
            worker.run(job.id, userId, zipPath)
        } catch (ex: Exception) {
            runCatching { Files.deleteIfExists(zipPath) }
            runCatching { Files.deleteIfExists(directory) }
            state.fail(job.id, "The archive upload could not be staged")
            throw ex
        }
        return ImportJobAcceptedResponse(job.id, job.status, "/imports/google-keep/${job.id}")
    }

    @Transactional(readOnly = true)
    fun get(userId: Long, id: UUID): ImportJobResponse {
        val job = repository.findByIdAndUserId(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "import_job_not_found", "Import job not found")
        val percent = if (job.totalNotes == 0) {
            if (job.status == ImportJobStatus.COMPLETED) 100 else 0
        } else {
            ((job.processedNotes.toLong() * 100) / job.totalNotes).coerceIn(0, 100).toInt()
        }
        return ImportJobResponse(
            jobId = job.id,
            status = job.status,
            totalNotes = job.totalNotes,
            processedNotes = job.processedNotes,
            importedNotes = job.importedNotes,
            skippedNotes = job.skippedNotes,
            warningCount = job.warningCount,
            warnings = state.readWarnings(job),
            progressPercent = percent,
            errorMessage = job.errorMessage,
            createdAt = job.createdAt,
            startedAt = job.startedAt,
            completedAt = job.completedAt,
        )
    }

    private fun copyUpload(file: MultipartFile, destination: Path) {
        var total = 0L
        val signature = ByteArray(4)
        var signatureLength = 0
        file.inputStream.use { input ->
            Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (signatureLength < signature.size) {
                        val count = minOf(read, signature.size - signatureLength)
                        buffer.copyInto(signature, signatureLength, 0, count)
                        signatureLength += count
                    }
                    total += read
                    if (total > properties.takeoutImport.maxUploadSize) {
                        throw ApiException(
                            HttpStatus.PAYLOAD_TOO_LARGE,
                            "archive_too_large",
                            "ZIP archive exceeds the size limit",
                        )
                    }
                    output.write(buffer, 0, read)
                }
            }
        }
        val zipSignature = signatureLength == 4 && signature[0] == 0x50.toByte() && signature[1] == 0x4b.toByte() &&
            signature[2] in setOf(0x03, 0x05, 0x07).map(Int::toByte) &&
            signature[3] in setOf(0x04, 0x06, 0x08).map(Int::toByte)
        if (!zipSignature) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_archive", "File is not a ZIP archive")
        }
    }
}

@RestController
class TakeoutImportController(private val service: TakeoutImportService) {
    @PostMapping("/imports/google-keep", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun submit(
        authentication: UsernamePasswordAuthenticationToken,
        @RequestPart("file") file: MultipartFile,
    ): ResponseEntity<ImportJobAcceptedResponse> {
        val userId = (authentication.principal as OpenKeepPrincipal).userId
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.submit(userId, file))
    }

    @GetMapping("/imports/google-keep/{jobId}")
    fun get(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable jobId: UUID,
    ): ImportJobResponse = service.get((authentication.principal as OpenKeepPrincipal).userId, jobId)
}
