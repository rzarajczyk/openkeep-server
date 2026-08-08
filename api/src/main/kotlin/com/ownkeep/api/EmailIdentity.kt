package com.ownkeep.api

import org.springframework.http.HttpStatus
import java.util.Locale
import java.util.regex.Pattern

private val EMAIL_PATTERN: Pattern =
    Pattern.compile(
        "^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$",
        Pattern.CASE_INSENSITIVE,
    )

fun normalizeEmail(raw: String): String = raw.trim().lowercase(Locale.ROOT)

fun isValidEmailShape(email: String): Boolean =
    email.length in 3..254 && EMAIL_PATTERN.matcher(email).matches()

fun validateUserEmail(raw: String): String {
    val email = normalizeEmail(raw)
    if (email.isBlank()) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_email", "email must not be blank")
    }
    if (email.length > 254) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_email", "email exceeds 254 characters")
    }
    if (!isValidEmailShape(email)) {
        throw ApiException(HttpStatus.BAD_REQUEST, "invalid_email", "email is not a valid address")
    }
    return email
}
