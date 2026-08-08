package com.ownkeep.api

import org.springframework.http.HttpMethod

/** Allows extension JARs (e.g. SaaS) to contribute unauthenticated HTTP routes. */
fun interface PublicEndpointContributor {
    fun contribute(registry: PublicEndpointRegistry)
}

class PublicEndpointRegistry {
    val postPaths = linkedSetOf<String>()
    val getPaths = linkedSetOf<String>()
    val anyPaths = linkedSetOf<String>()

    fun permitPost(path: String) {
        postPaths += path
    }

    fun permitGet(path: String) {
        getPaths += path
    }

    fun permitAll(path: String) {
        anyPaths += path
    }
}
