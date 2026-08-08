package com.ownkeep.api

import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant

data class ProvisionUserRequest(
    val email: String,
    val password: String,
    val role: UserRole = UserRole.USER,
    /** When true, mark verified immediately. When false, follow verification policy. */
    val markVerified: Boolean? = null,
)

data class ProvisionedUser(
    val user: UserEntity,
    val verificationEmailQueued: Boolean,
)

@Service
class UserProvisioningService(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
    private val properties: OwnKeepProperties,
    private val emailVerificationService: EmailVerificationService,
) {
    private val clock: Clock = Clock.systemUTC()

    @Transactional
    fun provision(request: ProvisionUserRequest): ProvisionedUser {
        validateUserPassword(request.password)
        val email = validateUserEmail(request.email)
        if (userRepository.findByEmail(email) != null) {
            throw ApiException(HttpStatus.CONFLICT, "email_taken", "A user with this email already exists")
        }
        val now = clock.instant()
        val verifiedNow = when {
            request.role == UserRole.ADMIN -> true
            request.markVerified != null -> request.markVerified
            !properties.emailVerificationRequired -> true
            else -> false
        }
        val user = userRepository.save(
            UserEntity(
                email = email,
                passwordHash = passwordEncoder.encode(request.password),
                enabled = true,
                role = request.role,
                emailVerifiedAt = if (verifiedNow) now else null,
                createdAt = now,
                updatedAt = now,
            ),
        )
        val queueVerification = !verifiedNow && properties.emailVerificationRequired
        if (queueVerification) {
            emailVerificationService.issueAndSendAfterCommit(user)
        }
        return ProvisionedUser(user, queueVerification)
    }
}
