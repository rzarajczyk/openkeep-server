package com.openkeep.api

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import java.time.Instant

class CoreUnitTests {
    private val markdown = MarkdownService()

    @Test
    fun `markdown is rendered and dangerous HTML is removed`() {
        val rendered = markdown.render("# Hello\n\n[safe](https://example.com)\n\n<script>alert(1)</script>")

        assertThat(rendered).contains("<h1>Hello</h1>")
        assertThat(rendered).contains("https://example.com")
        assertThat(rendered).doesNotContain("<script")
    }

    @Test
    fun `bare URLs are rendered as safe links`() {
        val rendered = markdown.render("Visit https://example.com/notes")

        assertThat(rendered)
            .contains("""<a href="https://example.com/notes"""")
            .contains(">https://example.com/notes</a>")
    }

    @Test
    fun `token hashing uses stable sha256`() {
        assertThat(AuthService.hashToken("opaque-token")).isEqualTo(
            "84d3f23da9b5f51b3269566eff05d3fb23607eeef89567f9cd280b90ca0dbc5c",
        )
    }

    @Test
    fun `user reconciliation rotates changed passwords and disables omitted users`() {
        val repository = Mockito.mock(UserRepository::class.java)
        val encoder = BCryptPasswordEncoder(4)
        val alice = UserEntity(1, "alice", encoder.encode("old-password"), true, Instant.now(), Instant.now())
        val bob = UserEntity(2, "bob", encoder.encode("bob-password"), true, Instant.now(), Instant.now())
        Mockito.`when`(repository.findAll()).thenReturn(listOf(alice, bob))

        UserReconciliationService(repository, encoder).reconcile(
            listOf(UserReconciliationService.ConfiguredUser("alice", "new-password")),
        )

        assertThat(encoder.matches("new-password", alice.passwordHash)).isTrue()
        assertThat(alice.enabled).isTrue()
        assertThat(bob.enabled).isFalse()
        Mockito.verify(repository).save(alice)
        Mockito.verify(repository).save(bob)
    }

    @Test
    fun `user reconciliation leaves matching enabled user hash unchanged`() {
        val repository = Mockito.mock(UserRepository::class.java)
        val encoder = BCryptPasswordEncoder(4)
        val hash = encoder.encode("same-password")
        val alice = UserEntity(1, "alice", hash, true, Instant.now(), Instant.now())
        Mockito.`when`(repository.findAll()).thenReturn(listOf(alice))

        UserReconciliationService(repository, encoder).reconcile(
            listOf(UserReconciliationService.ConfiguredUser("alice", "same-password")),
        )

        assertThat(alice.passwordHash).isEqualTo(hash)
        Mockito.verify(repository, Mockito.never()).save(Mockito.any(UserEntity::class.java))
    }
}
