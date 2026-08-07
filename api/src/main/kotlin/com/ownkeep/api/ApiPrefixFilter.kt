package com.ownkeep.api

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/**
 * Strips the `/api` prefix used by the SPA (and formerly by nginx) so controllers
 * keep their root mappings. Runs before Spring Security so matchers see stripped paths.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class ApiPrefixFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val path = requestPathWithinContext(request)
        if (path == "/api" || path.startsWith("/api/")) {
            val stripped = if (path == "/api") "/" else path.removePrefix("/api").ifEmpty { "/" }
            filterChain.doFilter(PrefixedRequest(request, stripped), response)
        } else {
            filterChain.doFilter(request, response)
        }
    }

    private fun requestPathWithinContext(request: HttpServletRequest): String {
        val uri = request.requestURI
        val contextPath = request.contextPath
        return if (contextPath.isNotEmpty() && uri.startsWith(contextPath)) {
            uri.substring(contextPath.length).ifEmpty { "/" }
        } else {
            uri
        }
    }

    private class PrefixedRequest(
        request: HttpServletRequest,
        private val strippedPath: String,
    ) : HttpServletRequestWrapper(request) {
        override fun getRequestURI(): String = contextPath + strippedPath

        override fun getServletPath(): String = strippedPath

        override fun getPathInfo(): String? = null
    }
}
