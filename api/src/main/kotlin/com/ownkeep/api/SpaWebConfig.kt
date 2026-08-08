package com.ownkeep.api

import org.springframework.context.annotation.Configuration
import org.springframework.core.io.Resource
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.resource.PathResourceResolver
import java.nio.file.Files

/**
 * Serves the built SPA from OWNKEEP_SPA_STATIC_DIR when present, then classpath:/static,
 * and falls back to index.html for client-side routes when the requested file does not exist.
 *
 * Controller mappings take precedence over this resource handler. API-shaped
 * paths are never rewritten to index.html so missing endpoints stay 404.
 */
@Configuration
class SpaWebConfig(
    private val properties: OwnKeepProperties,
) : WebMvcConfigurer {
    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        val locations = buildList {
            val dir = properties.spaStaticDir
            if (dir != null && Files.isDirectory(dir)) {
                add(dir.toUri().toString().let { if (it.endsWith("/")) it else "$it/" })
            }
            add("classpath:/static/")
        }.toTypedArray()

        registry
            .addResourceHandler("/**")
            .addResourceLocations(*locations)
            .resourceChain(true)
            .addResolver(
                object : PathResourceResolver() {
                    override fun getResource(resourcePath: String, location: Resource): Resource? {
                        val requested = location.createRelative(resourcePath)
                        if (requested.exists() && requested.isReadable) {
                            return requested
                        }
                        if (!shouldFallbackToIndex(resourcePath)) {
                            return null
                        }
                        val index = location.createRelative("index.html")
                        return index.takeIf { it.exists() && it.isReadable }
                    }
                },
            )
    }

    companion object {
        private val apiRoots = setOf(
            "auth",
            "me",
            "notes",
            "labels",
            "users",
            "attachments",
            "health",
            "actuator",
            "openapi.json",
            "search",
            "markdown",
        )

        internal fun shouldFallbackToIndex(resourcePath: String): Boolean {
            val path = resourcePath.trimStart('/')
            if (path.isEmpty() || path == "index.html") return true
            if (path == "verify-email" || path.startsWith("verify-email/")) return true
            val firstSegment = path.substringBefore('/')
            if (firstSegment in apiRoots) return false
            val fileName = path.substringAfterLast('/')
            if (fileName.contains('.')) return false
            return true
        }
    }
}
