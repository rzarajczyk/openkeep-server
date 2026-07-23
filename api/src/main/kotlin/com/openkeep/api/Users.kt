package com.openkeep.api

import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant

data class UserSummaryResponse(val id: Long, val login: String, val role: UserRole)

data class CreateUserRequest(
    @field:NotBlank
    @field:Size(max = 255)
    val login: String,
    @field:NotBlank
    @field:Size(max = 1024)
    val password: String,
)

data class ResetPasswordRequest(
    @field:NotBlank
    @field:Size(max = 1024)
    val newPassword: String,
)

@Service
class UserManagementService(
    private val userRepository: UserRepository,
    private val authTokenRepository: AuthTokenRepository,
    private val passwordEncoder: PasswordEncoder,
) {
    private val clock: Clock = Clock.systemUTC()

    @Transactional(readOnly = true)
    fun listUsers(): List<UserSummaryResponse> =
        userRepository.findAllByEnabledTrueOrderByLoginAsc().map { it.toSummary() }

    @Transactional
    fun createUser(request: CreateUserRequest): UserSummaryResponse {
        validateUserLogin(request.login)
        validateUserPassword(request.password)
        val login = request.login.trim()
        if (userRepository.findByLogin(login) != null) {
            throw ApiException(HttpStatus.CONFLICT, "login_taken", "A user with this login already exists")
        }
        val now = clock.instant()
        val user = userRepository.save(
            UserEntity(
                login = login,
                passwordHash = passwordEncoder.encode(request.password),
                enabled = true,
                role = UserRole.USER,
                createdAt = now,
                updatedAt = now,
            ),
        )
        return user.toSummary()
    }

    @Transactional
    fun softDeleteUser(actorId: Long, targetId: Long) {
        if (actorId == targetId) {
            throw ApiException(HttpStatus.BAD_REQUEST, "cannot_delete_self", "You cannot delete your own account")
        }
        val user = userRepository.findById(targetId).orElse(null)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "not_found", "User not found")
        if (!user.enabled) {
            throw ApiException(HttpStatus.NOT_FOUND, "not_found", "User not found")
        }
        if (user.role == UserRole.ADMIN) {
            throw ApiException(HttpStatus.BAD_REQUEST, "cannot_delete_admin", "The admin account cannot be deleted")
        }
        val now = clock.instant()
        user.enabled = false
        user.updatedAt = now
        userRepository.save(user)
        authTokenRepository.revokeAllForUser(requireNotNull(user.id), now)
    }

    @Transactional
    fun resetPassword(actorId: Long, targetId: Long, request: ResetPasswordRequest) {
        if (actorId == targetId) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "use_settings",
                "Use user settings to change your own password",
            )
        }
        validateUserPassword(request.newPassword, "new password")
        val user = userRepository.findById(targetId).orElse(null)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "not_found", "User not found")
        if (!user.enabled) {
            throw ApiException(HttpStatus.NOT_FOUND, "not_found", "User not found")
        }
        val now = clock.instant()
        user.passwordHash = passwordEncoder.encode(request.newPassword)
        user.updatedAt = now
        userRepository.save(user)
        authTokenRepository.revokeAllForUser(requireNotNull(user.id), now)
    }

    private fun UserEntity.toSummary() =
        UserSummaryResponse(id = requireNotNull(id), login = login, role = role)
}

@RestController
@RequestMapping("/users")
@PreAuthorize("hasRole('ADMIN')")
class UsersController(private val userManagementService: UserManagementService) {
    @GetMapping
    fun list(): List<UserSummaryResponse> = userManagementService.listUsers()

    @PostMapping
    fun create(@Valid @RequestBody request: CreateUserRequest): UserSummaryResponse =
        userManagementService.createUser(request)

    @DeleteMapping("/{id}")
    fun delete(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: Long,
    ): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        userManagementService.softDeleteUser(principal.userId, id)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{id}/reset-password")
    fun resetPassword(
        authentication: UsernamePasswordAuthenticationToken,
        @PathVariable id: Long,
        @Valid @RequestBody request: ResetPasswordRequest,
    ): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        userManagementService.resetPassword(principal.userId, id, request)
        return ResponseEntity.noContent().build()
    }
}
