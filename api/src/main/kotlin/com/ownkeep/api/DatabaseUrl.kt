package com.ownkeep.api

import org.springframework.boot.SpringApplication
import org.springframework.boot.env.EnvironmentPostProcessor
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.MapPropertySource
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class ParsedDatabaseUrl(
    val jdbcUrl: String,
    val username: String?,
    val password: String?,
)

object DatabaseUrls {
    /**
     * Accepts Neon/libpq URIs (`postgres://` / `postgresql://`) or JDBC URLs.
     * Credentials in the URI authority are extracted for Spring datasource properties
     * (the PostgreSQL JDBC driver does not accept user:pass in the host part).
     */
    fun parse(raw: String): ParsedDatabaseUrl {
        val trimmed = raw.trim()
        require(trimmed.isNotEmpty()) { "Database URL is empty" }

        if (trimmed.startsWith("jdbc:")) {
            return parseJdbc(trimmed)
        }
        if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) {
            return parseLibpq(trimmed)
        }
        throw IllegalArgumentException(
            "OWNKEEP_DATABASE_URL must be a postgres://, postgresql://, or jdbc:postgresql:// URL",
        )
    }

    private fun parseLibpq(raw: String): ParsedDatabaseUrl {
        val uri = URI(raw)
        val userInfo = uri.userInfo
        var username: String? = null
        var password: String? = null
        if (!userInfo.isNullOrEmpty()) {
            val sep = userInfo.indexOf(':')
            if (sep < 0) {
                username = decode(userInfo)
            } else {
                username = decode(userInfo.substring(0, sep))
                password = decode(userInfo.substring(sep + 1))
            }
        }
        val host = uri.host ?: throw IllegalArgumentException("Database URL is missing a host")
        val portPart = if (uri.port != -1) ":${uri.port}" else ""
        val path = uri.path.ifEmpty { "/" }
        val query = toJdbcQuery(uri.query, host)
        val jdbc = buildString {
            append("jdbc:postgresql://")
            append(host)
            append(portPart)
            append(path)
            if (query.isNotEmpty()) {
                append('?')
                append(query)
            }
        }
        return ParsedDatabaseUrl(jdbcUrl = jdbc, username = username, password = password)
    }

    private fun parseJdbc(raw: String): ParsedDatabaseUrl {
        // jdbc:postgresql://user:pass@host/db is non-standard; normalize if present.
        val withoutPrefix = raw.removePrefix("jdbc:")
        if (withoutPrefix.startsWith("postgresql://") || withoutPrefix.startsWith("postgres://")) {
            return parseLibpq(withoutPrefix)
        }
        // Already JDBC — still normalize known libpq query aliases (e.g. channel_binding).
        val qIndex = raw.indexOf('?')
        if (qIndex < 0) {
            return ParsedDatabaseUrl(jdbcUrl = raw, username = null, password = null)
        }
        val base = raw.substring(0, qIndex)
        val host = try {
            URI(raw.removePrefix("jdbc:")).host
        } catch (_: Exception) {
            null
        }
        val query = toJdbcQuery(raw.substring(qIndex + 1), host)
        val jdbc = if (query.isEmpty()) base else "$base?$query"
        return ParsedDatabaseUrl(jdbcUrl = jdbc, username = null, password = null)
    }

    /**
     * Preserve Neon/libpq query options for JDBC. Maps aliases the PG JDBC driver
     * understands (notably channel_binding → channelBinding).
     */
    internal fun toJdbcQuery(rawQuery: String?, host: String?): String {
        val params = linkedMapOf<String, String>()
        if (!rawQuery.isNullOrBlank()) {
            for (part in rawQuery.split('&')) {
                if (part.isEmpty()) continue
                val eq = part.indexOf('=')
                val key = if (eq < 0) part else part.substring(0, eq)
                val value = if (eq < 0) "" else part.substring(eq + 1)
                val jdbcKey = when (key) {
                    "channel_binding" -> "channelBinding"
                    else -> key
                }
                params[jdbcKey] = value
            }
        }
        val remote = host != null && host != "localhost" && host != "127.0.0.1" && host != "db"
        if (remote && !params.keys.any { it.equals("sslmode", ignoreCase = true) }) {
            params["sslmode"] = "require"
        }
        return params.entries.joinToString("&") { (k, v) -> if (v.isEmpty()) k else "$k=$v" }
    }

    private fun decode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8)
}

@Order(Ordered.HIGHEST_PRECEDENCE)
class DatabaseUrlEnvironmentPostProcessor : EnvironmentPostProcessor {
    override fun postProcessEnvironment(environment: ConfigurableEnvironment, application: SpringApplication) {
        val raw = environment.getProperty("OWNKEEP_DATABASE_URL")
            ?: environment.getProperty("spring.datasource.url")
            ?: return
        if (raw.isBlank()) return

        val parsed = try {
            DatabaseUrls.parse(raw)
        } catch (ex: IllegalArgumentException) {
            throw IllegalStateException(
                "Invalid database URL (OWNKEEP_DATABASE_URL / spring.datasource.url): ${ex.message}",
                ex,
            )
        }

        val props = linkedMapOf<String, Any>(
            "spring.datasource.url" to parsed.jdbcUrl,
            "OWNKEEP_DATABASE_URL" to parsed.jdbcUrl,
        )
        parsed.username?.let {
            props["spring.datasource.username"] = it
            props["OWNKEEP_DATABASE_USER"] = it
        }
        parsed.password?.let {
            props["spring.datasource.password"] = it
            props["OWNKEEP_DATABASE_PASSWORD"] = it
        }
        environment.propertySources.addFirst(MapPropertySource("ownkeepDatabaseUrl", props))
    }
}
