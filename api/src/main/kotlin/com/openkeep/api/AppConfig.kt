package com.openkeep.api

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableAsync
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import java.nio.file.Path
import java.time.Duration

@ConfigurationProperties("openkeep")
data class OpenKeepProperties(
    var usersJson: String = "",
    var tokenTtl: Duration = Duration.ofDays(30),
    var maxSyncLimit: Int = 200,
    var attachment: AttachmentProperties = AttachmentProperties(),
    var takeoutImport: TakeoutImportProperties = TakeoutImportProperties(),
) {
    data class AttachmentProperties(
        var storageRoot: Path = Path.of("./data/attachments"),
        var maxFileSize: Long = 25L * 1024 * 1024,
        var perUserQuota: Long = 1024L * 1024 * 1024,
    )

    data class TakeoutImportProperties(
        var stagingRoot: Path = Path.of("./data/imports"),
        var maxUploadSize: Long = 100L * 1024 * 1024,
        var maxEntries: Int = 5_000,
        var maxEntrySize: Long = 50L * 1024 * 1024,
        var maxUncompressedSize: Long = 500L * 1024 * 1024,
        var maxWarnings: Int = 100,
    )
}

@Configuration
@EnableMethodSecurity
@EnableAsync
class AppConfig {
    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder(12)

    @Bean
    fun securityFilterChain(
        http: HttpSecurity,
        tokenAuthenticationFilter: TokenAuthenticationFilter,
        apiAuthenticationEntryPoint: ApiAuthenticationEntryPoint,
        apiAccessDeniedHandler: ApiAccessDeniedHandler,
    ): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .exceptionHandling {
                it.authenticationEntryPoint(apiAuthenticationEntryPoint)
                it.accessDeniedHandler(apiAccessDeniedHandler)
            }
            .authorizeHttpRequests {
                it.requestMatchers(HttpMethod.POST, "/auth/login").permitAll()
                it.requestMatchers("/health", "/actuator/health", "/openapi.json").permitAll()
                it.anyRequest().authenticated()
            }
            .addFilterBefore(tokenAuthenticationFilter, UsernamePasswordAuthenticationFilter::class.java)
        return http.build()
    }
}
