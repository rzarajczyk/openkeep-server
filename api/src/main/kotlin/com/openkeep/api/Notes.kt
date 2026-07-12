package com.openkeep.api

import jakarta.validation.Valid
import jakarta.validation.constraints.Size
import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer
import org.owasp.html.HtmlPolicyBuilder
import org.owasp.html.PolicyFactory
import org.owasp.html.Sanitizers
import org.springframework.data.domain.PageRequest
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class NoteItemRequest(
    val id: UUID? = null,
    @field:Size(max = 10_000)
    val text: String,
    val checked: Boolean = false,
    val sortOrder: Int? = null,
)

data class CreateNoteRequest(
    val type: NoteType,
    @field:Size(max = 500)
    val title: String = "",
    @field:Size(max = 1_000_000)
    val contentRaw: String = "",
    @field:Size(max = 32)
    val backgroundColor: String = "default",
    val archived: Boolean = false,
    @field:Size(max = 1000)
    val items: List<@Valid NoteItemRequest> = emptyList(),
)

data class UpdateNoteRequest(
    val type: NoteType? = null,
    @field:Size(max = 500)
    val title: String? = null,
    @field:Size(max = 1_000_000)
    val contentRaw: String? = null,
    @field:Size(max = 32)
    val backgroundColor: String? = null,
    val archived: Boolean? = null,
    @field:Size(max = 1000)
    val items: List<@Valid NoteItemRequest>? = null,
    val version: Long? = null,
)

data class NoteItemResponse(val id: UUID, val text: String, val checked: Boolean, val sortOrder: Int)
data class AttachmentResponse(
    val id: UUID,
    val kind: AttachmentKind,
    val originalFilename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val createdAt: Instant,
    val url: String,
)

data class NoteResponse(
    val id: UUID,
    val type: NoteType,
    val title: String,
    val contentRaw: String,
    val contentRendered: String,
    val backgroundColor: String,
    val archived: Boolean,
    val items: List<NoteItemResponse>,
    val attachments: List<AttachmentResponse>,
    val createdAt: Instant,
    val updatedAt: Instant,
    val version: Long,
)

data class NotesSyncResponse(
    val items: List<NoteResponse>,
    val deletedIds: List<UUID>,
    val nextUpdatedAfter: Instant,
    val nextAfterId: UUID,
    val hasMore: Boolean,
)

@Component
class MarkdownService {
    private val extensions = listOf(AutolinkExtension.create())
    private val parser = Parser.builder().extensions(extensions).build()
    private val renderer = HtmlRenderer.builder().extensions(extensions).escapeHtml(true).build()
    private val policy: PolicyFactory = Sanitizers.FORMATTING
        .and(Sanitizers.BLOCKS)
        .and(Sanitizers.LINKS)
        .and(
            HtmlPolicyBuilder()
                .allowAttributes("class").matching(true, "language-[a-zA-Z0-9_-]+").onElements("code")
                .toFactory(),
        )

    fun render(markdown: String): String = policy.sanitize(renderer.render(parser.parse(markdown)))
}

@Service
class NoteService(
    private val noteRepository: NoteRepository,
    private val noteItemRepository: NoteItemRepository,
    private val attachmentRepository: AttachmentRepository,
    private val markdownService: MarkdownService,
    private val attachmentStorage: AttachmentStorage,
    private val properties: OpenKeepProperties,
) {
    @Transactional
    fun create(userId: Long, request: CreateNoteRequest): NoteResponse {
        validateState(request.type, request.contentRaw, request.items)
        val now = Instant.now()
        val note = noteRepository.save(
            NoteEntity(
                userId = userId,
                type = request.type,
                title = request.title.trim(),
                contentRaw = if (request.type == NoteType.TEXT) request.contentRaw else "",
                contentRendered = if (request.type == NoteType.TEXT) markdownService.render(request.contentRaw) else "",
                backgroundColor = validateColor(request.backgroundColor),
                archived = request.archived,
                createdAt = now,
                updatedAt = now,
            ),
        )
        replaceItems(note, request.items)
        return toResponse(note)
    }

    @Transactional(readOnly = true)
    fun get(userId: Long, id: UUID): NoteResponse = toResponse(findOwned(userId, id))

    @Transactional
    fun update(userId: Long, id: UUID, request: UpdateNoteRequest): NoteResponse {
        val note = findOwned(userId, id)
        if (request.version != null && request.version != note.version) {
            throw ApiException(HttpStatus.CONFLICT, "version_conflict", "The note has changed since it was loaded")
        }

        val targetType = request.type ?: note.type
        val targetContent = request.contentRaw ?: note.contentRaw
        val currentItems = if (note.type == NoteType.LIST) {
            noteItemRepository.findAllByNoteIdOrderBySortOrderAscIdAsc(note.id)
                .map { NoteItemRequest(id = it.id, text = it.text, checked = it.checked, sortOrder = it.sortOrder) }
        } else {
            emptyList()
        }
        val targetItems = request.items ?: if (targetType == NoteType.LIST) currentItems else emptyList()
        validateState(targetType, targetContent, targetItems)

        note.type = targetType
        request.title?.let { note.title = it.trim() }
        note.contentRaw = if (targetType == NoteType.TEXT) targetContent else ""
        note.contentRendered = if (targetType == NoteType.TEXT) markdownService.render(targetContent) else ""
        request.backgroundColor?.let { note.backgroundColor = validateColor(it) }
        request.archived?.let { note.archived = it }
        note.updatedAt = Instant.now()
        noteRepository.save(note)

        if (targetType == NoteType.TEXT) {
            noteItemRepository.deleteAllByNoteId(note.id)
        } else if (request.items != null || request.type != null) {
            replaceItems(note, targetItems)
        }
        return toResponse(note)
    }

    @Transactional
    fun delete(userId: Long, id: UUID) {
        val note = findOwned(userId, id)
        val now = Instant.now()
        note.deletedAt = now
        note.updatedAt = now
        noteRepository.save(note)
        noteItemRepository.deleteAllByNoteId(id)
        val attachments = attachmentRepository.findAllByNoteIdOrderByCreatedAtAscIdAsc(id)
        attachmentRepository.deleteAllByNoteId(id)
        attachmentStorage.deleteAfterCommit(attachments.map { it.storagePath })
    }

    @Transactional(readOnly = true)
    fun sync(
        userId: Long,
        updatedAfter: Instant?,
        afterId: UUID?,
        archived: Boolean?,
        requestedLimit: Int,
    ): NotesSyncResponse {
        if (updatedAfter == null && afterId != null) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_cursor", "after_id requires updated_after")
        }
        val limit = requestedLimit.coerceIn(1, properties.maxSyncLimit.coerceAtLeast(1))
        val cursorTime = updatedAfter ?: Instant.EPOCH
        val cursorId = afterId ?: UUID(0, 0)
        val rows = noteRepository.findSyncPage(userId, cursorTime, cursorId, archived, PageRequest.of(0, limit + 1))
        val page = rows.take(limit)
        val last = page.lastOrNull()
        return NotesSyncResponse(
            items = page.filter { it.deletedAt == null }.map(::toResponse),
            deletedIds = page.filter { it.deletedAt != null }.map { it.id },
            nextUpdatedAfter = last?.updatedAt ?: cursorTime,
            nextAfterId = last?.id ?: cursorId,
            hasMore = rows.size > limit,
        )
    }

    @Transactional(readOnly = true)
    fun search(userId: Long, query: String, requestedLimit: Int): List<NoteResponse> {
        val normalized = query.trim()
        if (normalized.isEmpty()) return emptyList()
        if (normalized.length > 500) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_query", "Search query exceeds 500 characters")
        }
        val escaped = normalized
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        val limit = requestedLimit.coerceIn(1, properties.maxSyncLimit.coerceAtLeast(1))
        return noteRepository.search(userId, "%$escaped%", PageRequest.of(0, limit)).map(::toResponse)
    }

    private fun findOwned(userId: Long, id: UUID): NoteEntity =
        noteRepository.findByIdAndUserIdAndDeletedAtIsNull(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "note_not_found", "Note not found")

    private fun replaceItems(note: NoteEntity, items: List<NoteItemRequest>) {
        noteItemRepository.deleteAllByNoteId(note.id)
        if (note.type == NoteType.LIST && items.isNotEmpty()) {
            noteItemRepository.saveAll(
                items.mapIndexed { index, item ->
                    NoteItemEntity(
                        id = item.id ?: UUID.randomUUID(),
                        noteId = note.id,
                        text = item.text,
                        checked = item.checked,
                        sortOrder = index,
                    )
                },
            )
        }
    }

    private fun validateState(type: NoteType, contentRaw: String, items: List<NoteItemRequest>) {
        when (type) {
            NoteType.TEXT -> if (items.isNotEmpty()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "invalid_note", "Text notes cannot contain list items")
            }
            NoteType.LIST -> if (contentRaw.isNotBlank()) {
                throw ApiException(HttpStatus.BAD_REQUEST, "invalid_note", "List notes cannot contain text content")
            }
        }
        if (items.any { it.text.length > 10_000 }) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_note", "List item text exceeds 10000 characters")
        }
        val itemIds = items.mapNotNull { it.id }
        if (itemIds.size != itemIds.distinct().size) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_note", "List item IDs must be unique")
        }
    }

    private fun validateColor(value: String): String {
        if (!Regex("^[#a-zA-Z0-9_-]{1,32}$").matches(value)) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_color", "Invalid background color")
        }
        return value
    }

    private fun toResponse(note: NoteEntity): NoteResponse {
        val items = if (note.type == NoteType.LIST) {
            noteItemRepository.findAllByNoteIdOrderBySortOrderAscIdAsc(note.id).map {
                NoteItemResponse(it.id, it.text, it.checked, it.sortOrder)
            }
        } else {
            emptyList()
        }
        val attachments = attachmentRepository.findAllByNoteIdOrderByCreatedAtAscIdAsc(note.id).map {
            AttachmentResponse(
                id = it.id,
                kind = it.kind,
                originalFilename = it.originalFilename,
                mimeType = it.mimeType,
                sizeBytes = it.sizeBytes,
                createdAt = it.createdAt,
                url = "/attachments/${it.id}",
            )
        }
        return NoteResponse(
            id = note.id,
            type = note.type,
            title = note.title,
            contentRaw = note.contentRaw,
            contentRendered = note.contentRendered,
            backgroundColor = note.backgroundColor,
            archived = note.archived,
            items = items,
            attachments = attachments,
            createdAt = note.createdAt,
            updatedAt = note.updatedAt,
            version = note.version,
        )
    }
}

@RestController
@RequestMapping("/notes")
class NoteController(private val noteService: NoteService) {
    @GetMapping
    fun sync(
        authentication: UsernamePasswordAuthenticationToken,
        @RequestParam(name = "updated_after", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
        updatedAfter: Instant?,
        @RequestParam(name = "after_id", required = false) afterId: UUID?,
        @RequestParam(required = false) archived: Boolean?,
        @RequestParam(defaultValue = "100") limit: Int,
    ) = noteService.sync(principal(authentication).userId, updatedAfter, afterId, archived, limit)

    @PostMapping
    fun create(
        authentication: UsernamePasswordAuthenticationToken,
        @Valid @RequestBody request: CreateNoteRequest,
    ) = noteService.create(principal(authentication).userId, request)

    @GetMapping("/{id}")
    fun get(authentication: UsernamePasswordAuthenticationToken, @PathVariable id: UUID) =
        noteService.get(principal(authentication).userId, id)

    @PatchMapping("/{id}")
    fun update(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
        @Valid @RequestBody request: UpdateNoteRequest,
    ) = noteService.update(principal(authentication).userId, id, request)

    @DeleteMapping("/{id}")
    fun delete(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
    ): ResponseEntity<Void> {
        noteService.delete(principal(authentication).userId, id)
        return ResponseEntity.noContent().build()
    }
}

@RestController
class SearchController(private val noteService: NoteService) {
    @GetMapping("/search")
    fun search(
        authentication: UsernamePasswordAuthenticationToken,
        @RequestParam q: String,
        @RequestParam(defaultValue = "100") limit: Int,
    ) = noteService.search(principal(authentication).userId, q, limit)
}

private fun principal(authentication: UsernamePasswordAuthenticationToken) =
    authentication.principal as OpenKeepPrincipal
