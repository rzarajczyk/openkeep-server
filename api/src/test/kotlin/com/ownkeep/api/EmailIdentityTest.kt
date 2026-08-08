package com.ownkeep.api

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test

class EmailIdentityTest {
    @Test
    fun `normalizeEmail lowercases and trims`() {
        assertThat(normalizeEmail("  Alice@Example.COM ")).isEqualTo("alice@example.com")
    }

    @Test
    fun `validateUserEmail accepts common addresses`() {
        assertThat(validateUserEmail("user+tag@example.com")).isEqualTo("user+tag@example.com")
    }

    @Test
    fun `validateUserEmail rejects non-email identities`() {
        assertThatThrownBy { validateUserEmail("admin") }
            .isInstanceOf(ApiException::class.java)
            .extracting("code")
            .isEqualTo("invalid_email")
    }
}
