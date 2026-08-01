package com.openkeep.api

import org.springframework.http.HttpStatus
import java.util.Base64

object CryptoSupport {
    private val decoder = Base64.getDecoder()
    private val encoder = Base64.getEncoder()

    fun encode(bytes: ByteArray): String = encoder.encodeToString(bytes)

    fun decodeRequired(value: String, field: String, minBytes: Int = 1, maxBytes: Int = 2_000_000): ByteArray {
        if (value.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_ciphertext", "$field must not be blank")
        }
        val bytes = try {
            decoder.decode(value)
        } catch (_: IllegalArgumentException) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_ciphertext", "$field is not valid base64")
        }
        if (bytes.size < minBytes || bytes.size > maxBytes) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_ciphertext",
                "$field must be between $minBytes and $maxBytes bytes",
            )
        }
        return bytes
    }

    fun decodeOptional(value: String?, field: String, minBytes: Int = 1, maxBytes: Int = 2_000_000): ByteArray? {
        if (value == null) return null
        return decodeRequired(value, field, minBytes, maxBytes)
    }
}
