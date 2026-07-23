package com.openkeep.api

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64

data class LoginRequest(
    @field:NotBlank
    @field:Size(max = 255)
    val login: String,
    @field:NotBlank
    @field:Size(max = 1024)
    val password: String,
)

data class ChangePasswordRequest(
    @field:NotBlank
    @field:Size(max = 1024)
    val currentPassword: String,
    @field:NotBlank
    @field:Size(max = 1024)
    val newPassword: String,
)

data class MeResponse(val id: Long, val login: String, val role: UserRole)
data class LoginResponse(val token: String, val expiresAt: Instant, val user: MeResponse)

data class OpenKeepPrincipal(
    val userId: Long,
    private val login: String,
    val role: UserRole,
    val tokenHash: String,
) : UserDetails {
    override fun getAuthorities() = listOf(SimpleGrantedAuthority("ROLE_${role.name}"))
    override fun getPassword() = ""
    override fun getUsername() = login
    override fun isAccountNonExpired() = true
    override fun isAccountNonLocked() = true
    override fun isCredentialsNonExpired() = true
    override fun isEnabled() = true
}

fun validateUserPassword(password: String, label: String = "password") {
    if (password.isBlank()) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_password", "$label must not be blank")
    }
    if (password.toByteArray(StandardCharsets.UTF_8).size > 72) {
        throw ApiException(
            HttpStatus.BAD_REQUEST,
            "invalid_password",
            "$label exceeds bcrypt's 72-byte limit",
        )
    }
}

fun validateUserLogin(login: String) {
    val trimmed = login.trim()
    if (trimmed.isBlank()) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_login", "login must not be blank")
    }
    if (trimmed.length > 255) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_login", "login exceeds 255 characters")
    }
}

@Service
class AdminBootstrapService(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
) {
    fun hasEnabledAdmin(): Boolean = userRepository.existsByRoleAndEnabledTrue(UserRole.ADMIN)

    @Transactional
    fun bootstrap(username: String, password: String) {
        if (hasEnabledAdmin()) return

        validateUserLogin(username)
        validateUserPassword(password, "admin password")
        val login = username.trim()
        val now = Instant.now()
        val existing = userRepository.findByLogin(login)
        if (existing != null) {
            if (!existing.enabled) {
                throw IllegalStateException(
                    "OPENKEEP_ADMIN_USERNAME matches a disabled user; re-enable or choose a different admin username",
                )
            }
            existing.role = UserRole.ADMIN
            existing.passwordHash = passwordEncoder.encode(password)
            existing.updatedAt = now
            userRepository.save(existing)
            return
        }

        userRepository.save(
            UserEntity(
                login = login,
                passwordHash = passwordEncoder.encode(password),
                enabled = true,
                role = UserRole.ADMIN,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }
}

@Component
class AdminBootstrapRunner(
    private val properties: OpenKeepProperties,
    private val bootstrapService: AdminBootstrapService,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        require(properties.tokenTtl.isNegative.not() && properties.tokenTtl.isZero.not()) {
            "openkeep.token-ttl must be positive"
        }
        require(properties.maxSyncLimit > 0) { "openkeep.max-sync-limit must be positive" }
        require(properties.loginRateLimit.maxAttemptsPerIp > 0) {
            "openkeep.login-rate-limit.max-attempts-per-ip must be positive"
        }
        require(properties.loginRateLimit.maxAttemptsPerLogin > 0) {
            "openkeep.login-rate-limit.max-attempts-per-login must be positive"
        }
        require(!properties.loginRateLimit.window.isNegative && !properties.loginRateLimit.window.isZero) {
            "openkeep.login-rate-limit.window must be positive"
        }
        require(properties.attachment.maxFileSize > 0) { "openkeep.attachment.max-file-size must be positive" }
        require(properties.attachment.perUserQuota > 0) { "openkeep.attachment.per-user-quota must be positive" }
        require(properties.takeoutImport.maxUploadSize > 0) { "openkeep.takeout-import.max-upload-size must be positive" }
        require(properties.takeoutImport.maxEntries > 0) { "openkeep.takeout-import.max-entries must be positive" }
        require(properties.takeoutImport.maxEntrySize > 0) { "openkeep.takeout-import.max-entry-size must be positive" }
        require(properties.takeoutImport.maxUncompressedSize > 0) {
            "openkeep.takeout-import.max-uncompressed-size must be positive"
        }
        require(properties.takeoutImport.maxWarnings > 0) { "openkeep.takeout-import.max-warnings must be positive" }

        if (bootstrapService.hasEnabledAdmin()) return

        if (properties.adminUsername.isBlank() || properties.adminPassword.isBlank()) {
            throw IllegalStateException(
                "OPENKEEP_ADMIN_USERNAME and OPENKEEP_ADMIN_PASSWORD are required when no admin user exists",
            )
        }
        bootstrapService.bootstrap(properties.adminUsername, properties.adminPassword)
    }
}

@Service
class AuthService(
    private val userRepository: UserRepository,
    private val authTokenRepository: AuthTokenRepository,
    private val passwordEncoder: PasswordEncoder,
    private val properties: OpenKeepProperties,
) {
    private val secureRandom = SecureRandom()
    private val clock: Clock = Clock.systemUTC()

    @Transactional
    fun login(request: LoginRequest): LoginResponse {
        val user = userRepository.findByLogin(request.login.trim())
        val passwordWithinBcryptLimit = request.password.toByteArray(StandardCharsets.UTF_8).size <= 72
        val passwordMatches = passwordWithinBcryptLimit && runCatching {
            passwordEncoder.matches(request.password, user?.passwordHash ?: DUMMY_PASSWORD_HASH)
        }.getOrDefault(false)
        val valid = user != null && user.enabled && passwordMatches
        if (!valid) throw ApiException(HttpStatus.UNAUTHORIZED, "invalid_credentials", "Invalid login or password")

        val rawTokenBytes = ByteArray(32).also(secureRandom::nextBytes)
        val rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(rawTokenBytes)
        val now = clock.instant()
        val expiresAt = now.plus(properties.tokenTtl)
        authTokenRepository.save(
            AuthTokenEntity(
                userId = requireNotNull(user.id),
                tokenHash = hashToken(rawToken),
                expiresAt = expiresAt,
                createdAt = now,
            ),
        )
        authTokenRepository.deleteExpiredAndRevokedBefore(now.minusSeconds(7 * 24 * 60 * 60))
        return LoginResponse(
            rawToken,
            expiresAt,
            MeResponse(requireNotNull(user.id), user.login, user.role),
        )
    }

    @Transactional(readOnly = true)
    fun authenticate(rawToken: String): OpenKeepPrincipal? {
        if (rawToken.length !in 32..256) return null
        val token = authTokenRepository.findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(hashToken(rawToken), clock.instant())
            ?: return null
        val user = userRepository.findById(token.userId).orElse(null) ?: return null
        if (!user.enabled) return null
        return OpenKeepPrincipal(requireNotNull(user.id), user.login, user.role, token.tokenHash)
    }

    @Transactional
    fun logout(tokenHash: String) {
        authTokenRepository.revoke(tokenHash, clock.instant())
    }

    @Transactional
    fun changePassword(userId: Long, request: ChangePasswordRequest) {
        validateUserPassword(request.newPassword, "new password")
        val user = userRepository.findById(userId).orElse(null)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "not_found", "User not found")
        val currentWithinLimit = request.currentPassword.toByteArray(StandardCharsets.UTF_8).size <= 72
        val matches = currentWithinLimit && runCatching {
            passwordEncoder.matches(request.currentPassword, user.passwordHash)
        }.getOrDefault(false)
        if (!matches) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_credentials", "Current password is incorrect")
        }
        val now = clock.instant()
        user.passwordHash = passwordEncoder.encode(request.newPassword)
        user.updatedAt = now
        userRepository.save(user)
        authTokenRepository.revokeAllForUser(userId, now)
    }

    companion object {
        private const val DUMMY_PASSWORD_HASH = "\$2a\$12\$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"

        fun hashToken(rawToken: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(rawToken.toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}

/**
 * Fixed-window rate limiter for login attempts.
 * Limits by client IP and by login name so both single-IP floods and
 * distributed guessing against one account are throttled.
 */
class LoginRateLimiter(
    private val properties: OpenKeepProperties,
    private val clock: Clock = Clock.systemUTC(),
) {
    private val buckets = java.util.concurrent.ConcurrentHashMap<String, Window>()

    fun check(clientIp: String, login: String) {
        val config = properties.loginRateLimit
        val retryAfter = consume("ip:$clientIp", config.maxAttemptsPerIp, config.window)
            ?: consume("login:${login.lowercase()}", config.maxAttemptsPerLogin, config.window)
        if (retryAfter != null) {
            throw ApiException(
                HttpStatus.TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many login attempts. Try again later.",
                retryAfterSeconds = retryAfter,
            )
        }
    }

    /** Returns remaining seconds until the window resets when limited; null when allowed. */
    fun consume(key: String, maxAttempts: Int, window: Duration): Long? {
        if (maxAttempts <= 0) return null
        val now = clock.instant()
        val windowMillis = window.toMillis().coerceAtLeast(1)
        var retryAfterSeconds: Long? = null
        buckets.compute(key) { _, existing ->
            if (existing == null || now.isAfter(existing.start.plusMillis(windowMillis))) {
                Window(now)
            } else {
                val count = existing.count.incrementAndGet()
                if (count > maxAttempts) {
                    val elapsed = java.time.Duration.between(existing.start, now).toMillis()
                    retryAfterSeconds = ((windowMillis - elapsed + 999) / 1000).coerceAtLeast(1)
                }
                existing
            }
        }
        maybePrune(now, windowMillis)
        return retryAfterSeconds
    }

    private fun maybePrune(now: Instant, windowMillis: Long) {
        if (buckets.size < 1_000) return
        buckets.entries.removeIf { (_, window) -> now.isAfter(window.start.plusMillis(windowMillis * 2)) }
    }

    private class Window(
        val start: Instant,
        val count: java.util.concurrent.atomic.AtomicInteger = java.util.concurrent.atomic.AtomicInteger(1),
    )
}

@Component
class TokenAuthenticationFilter(private val authService: AuthService) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val header = request.getHeader("Authorization")
        if (SecurityContextHolder.getContext().authentication == null && header?.startsWith("Bearer ") == true) {
            val rawToken = header.substring(7).trim()
            authService.authenticate(rawToken)?.let { principal ->
                val authentication = UsernamePasswordAuthenticationToken(principal, null, principal.authorities)
                authentication.details = WebAuthenticationDetailsSource().buildDetails(request)
                SecurityContextHolder.getContext().authentication = authentication
            }
        }
        filterChain.doFilter(request, response)
    }
}

@RestController
@RequestMapping("/auth")
class AuthController(
    private val authService: AuthService,
    private val loginRateLimiter: LoginRateLimiter,
) {
    @PostMapping("/login")
    fun login(
        @Valid @RequestBody request: LoginRequest,
        httpRequest: HttpServletRequest,
    ): LoginResponse {
        loginRateLimiter.check(clientIp(httpRequest), request.login.trim())
        return authService.login(request)
    }

    @PostMapping("/logout")
    fun logout(authentication: UsernamePasswordAuthenticationToken): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        authService.logout(principal.tokenHash)
        return ResponseEntity.noContent().build()
    }

    private fun clientIp(request: HttpServletRequest): String =
        request.remoteAddr?.takeIf { it.isNotBlank() } ?: "unknown"
}

@RestController
class MeController(private val authService: AuthService) {
    @GetMapping("/me")
    fun me(authentication: UsernamePasswordAuthenticationToken): MeResponse {
        val principal = authentication.principal as OpenKeepPrincipal
        return MeResponse(principal.userId, principal.username, principal.role)
    }

    @PatchMapping("/me/password")
    fun changePassword(
        authentication: UsernamePasswordAuthenticationToken,
        @Valid @RequestBody request: ChangePasswordRequest,
    ): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        authService.changePassword(principal.userId, request)
        return ResponseEntity.noContent().build()
    }
}
