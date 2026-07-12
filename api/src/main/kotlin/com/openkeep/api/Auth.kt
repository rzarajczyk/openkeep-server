package com.openkeep.api

import com.fasterxml.jackson.databind.ObjectMapper
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
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.filter.OncePerRequestFilter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
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

data class MeResponse(val id: Long, val login: String)
data class LoginResponse(val token: String, val expiresAt: Instant, val user: MeResponse)

data class OpenKeepPrincipal(
    val userId: Long,
    private val login: String,
    val tokenHash: String,
) : UserDetails {
    override fun getAuthorities() = emptyList<org.springframework.security.core.GrantedAuthority>()
    override fun getPassword() = ""
    override fun getUsername() = login
    override fun isAccountNonExpired() = true
    override fun isAccountNonLocked() = true
    override fun isCredentialsNonExpired() = true
    override fun isEnabled() = true
}

@Service
class UserReconciliationService(
    private val userRepository: UserRepository,
    private val passwordEncoder: PasswordEncoder,
) {
    data class ConfiguredUser(val login: String, val password: String)

    @Transactional
    fun reconcile(configured: List<ConfiguredUser>) {
        val now = Instant.now()
        val existing = userRepository.findAll().associateBy { it.login }
        configured.forEach { configuredUser ->
            val user = existing[configuredUser.login]
            if (user == null) {
                userRepository.save(
                    UserEntity(
                        login = configuredUser.login,
                        passwordHash = passwordEncoder.encode(configuredUser.password),
                        enabled = true,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
            } else {
                var changed = false
                val passwordMatches = try {
                    passwordEncoder.matches(configuredUser.password, user.passwordHash)
                } catch (_: IllegalArgumentException) {
                    false
                }
                if (!passwordMatches) {
                    user.passwordHash = passwordEncoder.encode(configuredUser.password)
                    changed = true
                }
                if (!user.enabled) {
                    user.enabled = true
                    changed = true
                }
                if (changed) {
                    user.updatedAt = now
                    userRepository.save(user)
                }
            }
        }

        val configuredLogins = configured.mapTo(mutableSetOf()) { it.login }
        existing.values.filter { it.login !in configuredLogins && it.enabled }.forEach {
            it.enabled = false
            it.updatedAt = now
            userRepository.save(it)
        }
    }
}

@Component
class UserReconciliationRunner(
    private val properties: OpenKeepProperties,
    private val objectMapper: ObjectMapper,
    private val reconciliationService: UserReconciliationService,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        require(!properties.tokenTtl.isNegative && !properties.tokenTtl.isZero) {
            "openkeep.token-ttl must be positive"
        }
        require(properties.maxSyncLimit > 0) { "openkeep.max-sync-limit must be positive" }
        require(properties.attachment.maxFileSize > 0) { "openkeep.attachment.max-file-size must be positive" }
        require(properties.attachment.perUserQuota > 0) { "openkeep.attachment.per-user-quota must be positive" }
        val configured = parse(properties.usersJson)
        if (configured.isEmpty()) {
            throw IllegalStateException("OPENKEEP_USERS_JSON must configure at least one user")
        }
        reconciliationService.reconcile(configured)
    }

    private fun parse(json: String): List<UserReconciliationService.ConfiguredUser> {
        if (json.isBlank()) return emptyList()
        val root = try {
            objectMapper.readTree(json)
        } catch (ex: Exception) {
            throw IllegalStateException("OPENKEEP_USERS_JSON must be a valid JSON array", ex)
        }
        if (!root.isArray) throw IllegalStateException("OPENKEEP_USERS_JSON must be a JSON array")
        val users = root.mapIndexed { index, node ->
            val loginNode = node.get("login")
            val passwordNode = node.get("password")
            if (!node.isObject || loginNode == null || !loginNode.isTextual || passwordNode == null || !passwordNode.isTextual) {
                throw IllegalStateException("OPENKEEP_USERS_JSON entry $index must contain string login and password fields")
            }
            val login = loginNode.asText().trim()
            val password = passwordNode.asText()
            if (login.isBlank() || password.isBlank()) {
                throw IllegalStateException("OPENKEEP_USERS_JSON entry $index has a blank login or password")
            }
            if (login.length > 255) {
                throw IllegalStateException("OPENKEEP_USERS_JSON entry $index login exceeds 255 characters")
            }
            if (password.toByteArray(StandardCharsets.UTF_8).size > 72) {
                throw IllegalStateException("OPENKEEP_USERS_JSON entry $index password exceeds bcrypt's 72-byte limit")
            }
            UserReconciliationService.ConfiguredUser(login, password)
        }
        val duplicates = users.groupBy { it.login }.filterValues { it.size > 1 }.keys
        if (duplicates.isNotEmpty()) {
            throw IllegalStateException("OPENKEEP_USERS_JSON contains duplicate logins: ${duplicates.sorted().joinToString()}")
        }
        return users
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
        return LoginResponse(rawToken, expiresAt, MeResponse(requireNotNull(user.id), user.login))
    }

    @Transactional(readOnly = true)
    fun authenticate(rawToken: String): OpenKeepPrincipal? {
        if (rawToken.length !in 32..256) return null
        val token = authTokenRepository.findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(hashToken(rawToken), clock.instant())
            ?: return null
        val user = userRepository.findById(token.userId).orElse(null) ?: return null
        if (!user.enabled) return null
        return OpenKeepPrincipal(requireNotNull(user.id), user.login, token.tokenHash)
    }

    @Transactional
    fun logout(tokenHash: String) {
        authTokenRepository.revoke(tokenHash, clock.instant())
    }

    companion object {
        private const val DUMMY_PASSWORD_HASH = "\$2a\$12\$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"

        fun hashToken(rawToken: String): String =
            MessageDigest.getInstance("SHA-256")
                .digest(rawToken.toByteArray(StandardCharsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
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
class AuthController(private val authService: AuthService) {
    @PostMapping("/login")
    fun login(@Valid @RequestBody request: LoginRequest) = authService.login(request)

    @PostMapping("/logout")
    fun logout(authentication: UsernamePasswordAuthenticationToken): ResponseEntity<Void> {
        val principal = authentication.principal as OpenKeepPrincipal
        authService.logout(principal.tokenHash)
        return ResponseEntity.noContent().build()
    }
}

@RestController
class MeController {
    @GetMapping("/me")
    fun me(authentication: UsernamePasswordAuthenticationToken): MeResponse {
        val principal = authentication.principal as OpenKeepPrincipal
        return MeResponse(principal.userId, principal.username)
    }
}
