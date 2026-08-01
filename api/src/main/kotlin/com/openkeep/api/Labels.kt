package com.openkeep.api

import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class CreateLabelRequest(
    @field:NotBlank
    val ciphertext: String,
)

data class UpdateLabelRequest(
    @field:NotBlank
    val ciphertext: String,
)

data class LabelResponse(
    val id: UUID,
    val ciphertext: String,
    val createdAt: Instant,
)

@Service
class LabelService(
    private val labelRepository: LabelRepository,
    private val noteLabelRepository: NoteLabelRepository,
) {
    @Transactional(readOnly = true)
    fun list(userId: Long): List<LabelResponse> =
        labelRepository.findAllByUserIdOrderByCreatedAtAscIdAsc(userId).map(::toResponse)

    @Transactional
    fun create(userId: Long, request: CreateLabelRequest): LabelResponse {
        val ciphertext = CryptoSupport.decodeRequired(request.ciphertext, "ciphertext", minBytes = 28, maxBytes = 16_384)
        val label = labelRepository.save(
            LabelEntity(
                userId = userId,
                ciphertext = ciphertext,
                createdAt = Instant.now(),
            ),
        )
        return toResponse(label)
    }

    @Transactional
    fun update(userId: Long, id: UUID, request: UpdateLabelRequest): LabelResponse {
        val label = labelRepository.findByIdAndUserId(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "label_not_found", "Label not found")
        label.ciphertext = CryptoSupport.decodeRequired(request.ciphertext, "ciphertext", minBytes = 28, maxBytes = 16_384)
        return toResponse(labelRepository.save(label))
    }

    @Transactional
    fun delete(userId: Long, id: UUID) {
        val label = labelRepository.findByIdAndUserId(id, userId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "label_not_found", "Label not found")
        noteLabelRepository.deleteAllByLabelId(label.id)
        labelRepository.delete(label)
    }

    private fun toResponse(label: LabelEntity) = LabelResponse(
        id = label.id,
        ciphertext = CryptoSupport.encode(label.ciphertext),
        createdAt = label.createdAt,
    )
}

@RestController
@RequestMapping("/labels")
class LabelController(private val labelService: LabelService) {
    @GetMapping
    fun list(authentication: UsernamePasswordAuthenticationToken) =
        labelService.list(principal(authentication).userId)

    @PostMapping
    fun create(
        authentication: UsernamePasswordAuthenticationToken,
        @Valid @RequestBody request: CreateLabelRequest,
    ) = labelService.create(principal(authentication).userId, request)

    @PatchMapping("/{id}")
    fun update(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
        @Valid @RequestBody request: UpdateLabelRequest,
    ) = labelService.update(principal(authentication).userId, id, request)

    @DeleteMapping("/{id}")
    fun delete(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: UUID,
    ): ResponseEntity<Void> {
        labelService.delete(principal(authentication).userId, id)
        return ResponseEntity.noContent().build()
    }
}
