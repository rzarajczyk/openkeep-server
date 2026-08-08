package com.ownkeep.api

import com.ownkeep.api.storage.AttachmentBlobStore
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

/**
 * Before admin bootstrap: permanently delete accounts whose identity is not a valid email,
 * and mark remaining legacy email accounts as verified.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class LegacyNonEmailUserCleanupRunner(
    private val cleanupService: LegacyNonEmailUserCleanupService,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        cleanupService.cleanup()
    }
}

@Service
class LegacyNonEmailUserCleanupService(
    private val userRepository: UserRepository,
    private val attachmentRepository: AttachmentRepository,
    private val attachmentBlobStore: AttachmentBlobStore,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional
    fun cleanup() {
        val all = userRepository.findAll()
        var deleted = 0
        var verified = 0
        val now = Instant.now()
        for (user in all) {
            if (!isValidEmailShape(normalizeEmail(user.email))) {
                val userId = requireNotNull(user.id)
                val storagePaths = attachmentRepository.findStoragePathsByUserId(userId)
                userRepository.delete(user)
                attachmentBlobStore.deleteAfterCommit(storagePaths)
                deleted += 1
                continue
            }
            // Normalize casing for legacy rows.
            val normalized = normalizeEmail(user.email)
            if (user.email != normalized) {
                user.email = normalized
            }
            if (user.emailVerifiedAt == null) {
                user.emailVerifiedAt = now
                verified += 1
            }
            user.updatedAt = now
            userRepository.save(user)
        }
        if (deleted > 0 || verified > 0) {
            log.info(
                "Email identity migration: deleted {} non-email account(s), marked {} account(s) verified",
                deleted,
                verified,
            )
        }
    }
}
