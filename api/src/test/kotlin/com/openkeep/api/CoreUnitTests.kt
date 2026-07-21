package com.openkeep.api

import com.fasterxml.jackson.databind.ObjectMapper
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

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
    fun `strikethrough is rendered`() {
        val rendered = markdown.render("Say ~~goodbye~~")

        assertThat(rendered).contains("<del>goodbye</del>")
    }

    @Test
    fun `inline markdown keeps emphasis links and code without blocks`() {
        val rendered = markdown.renderInline(
            "**bold** _italic_ `code` [docs](https://example.com) ~~old~~\n\n# Heading\n\n![x](https://example.com/x.png)",
        )

        assertThat(rendered)
            .contains("<strong>bold</strong>")
            .contains("<em>italic</em>")
            .contains("<code>code</code>")
            .contains("""href="https://example.com""")
            .contains("<del>old</del>")
            .doesNotContain("<h1")
            .doesNotContain("<img")
            .doesNotContain("<p>")
    }

    @Test
    fun `attachment filenames resolve to attachment urls and external images remain`() {
        val attachmentId = java.util.UUID.fromString("11111111-1111-1111-1111-111111111111")
        val rendered = markdown.render(
            "Local ![shot](Photo.JPG)\n\nRemote ![cdn](https://cdn.example.com/a.png)",
            listOf(
                MarkdownAttachmentRef(
                    id = attachmentId,
                    originalFilename = "photo.jpg",
                    kind = AttachmentKind.IMAGE,
                ),
            ),
        )

        assertThat(rendered)
            .contains("""src="/attachments/$attachmentId""")
            .contains("""src="https://cdn.example.com/a.png""")
            .doesNotContain("Photo.JPG")
    }

    @Test
    fun `fenced code keeps a pre wrapper`() {
        val rendered = markdown.render("```\nval x = 1\n```")

        assertThat(rendered).contains("<pre>")
        assertThat(rendered).contains("<code>")
    }

    @Test
    fun `underline and horizontal rules are preserved`() {
        val rendered = markdown.render("Hello <u>there</u>\n\n---\n")

        assertThat(rendered).contains("<u>there</u>")
        assertThat(rendered).contains("<hr")
    }

    @Test
    fun `token hashing uses stable sha256`() {
        assertThat(AuthService.hashToken("opaque-token")).isEqualTo(
            "84d3f23da9b5f51b3269566eff05d3fb23607eeef89567f9cd280b90ca0dbc5c",
        )
    }

    @Test
    fun `login rate limiter blocks after max attempts and resets after the window`() {
        val start = Instant.parse("2026-07-20T12:00:00Z")
        val clock = MutableClock(start)
        val limiter = LoginRateLimiter(
            OpenKeepProperties(
                loginRateLimit = OpenKeepProperties.LoginRateLimitProperties(
                    maxAttemptsPerIp = 3,
                    maxAttemptsPerLogin = 100,
                    window = Duration.ofMinutes(1),
                ),
            ),
            clock,
        )

        repeat(3) { limiter.check("203.0.113.10", "alice") }
        assertThatThrownBy { limiter.check("203.0.113.10", "alice") }
            .isInstanceOf(ApiException::class.java)
            .satisfies({ ex ->
                val api = ex as ApiException
                assertThat(api.status).isEqualTo(HttpStatus.TOO_MANY_REQUESTS)
                assertThat(api.code).isEqualTo("rate_limited")
                assertThat(api.retryAfterSeconds).isEqualTo(60)
            })

        clock.instant = start.plusSeconds(61)
        limiter.check("203.0.113.10", "alice")
    }

    @Test
    fun `login rate limiter throttles by login name across different IPs`() {
        val limiter = LoginRateLimiter(
            OpenKeepProperties(
                loginRateLimit = OpenKeepProperties.LoginRateLimitProperties(
                    maxAttemptsPerIp = 100,
                    maxAttemptsPerLogin = 2,
                    window = Duration.ofMinutes(1),
                ),
            ),
        )

        limiter.check("203.0.113.1", "Alice")
        limiter.check("203.0.113.2", "alice")
        assertThatThrownBy { limiter.check("203.0.113.3", "ALICE") }
            .isInstanceOf(ApiException::class.java)
            .extracting("code")
            .isEqualTo("rate_limited")
    }

    @Test
    fun `Keep parser preserves note fields and ignores collaboration annotations`() {
        val node = ObjectMapper().readTree(
            """
            {
              "title": "Shopping",
              "listContent": [
                {"text": "Milk", "isChecked": true},
                {"text": "Bread", "isChecked": false}
              ],
              "color": "BLUE",
              "isArchived": true,
              "isPinned": true,
              "createdTimestampUsec": "1700000000000000",
              "userEditedTimestampUsec": "1700000100000000",
              "labels": [{"name": "Home"}, {"name": "Errands"}],
              "attachments": [{"filePath": "Takeout/Keep/photo.jpg", "mimetype": "image/jpeg"}],
              "annotations": [{"webLink": {"url": "https://preview.example"}}],
              "sharees": [{"email": "other@example.com"}]
            }
            """.trimIndent(),
        )

        val note = TakeoutNoteParser().parse(node)

        assertThat(note.type).isEqualTo(NoteType.LIST)
        assertThat(note.items).containsExactly(
            TakeoutItem("Milk", true),
            TakeoutItem("Bread", false),
        )
        assertThat(note.color).isEqualTo("#cbf0f8")
        assertThat(note.archived).isTrue()
        assertThat(note.pinned).isTrue()
        assertThat(note.labels).containsExactly("Home", "Errands")
        assertThat(note.attachments).containsExactly(TakeoutAttachment("Takeout/Keep/photo.jpg"))
        assertThat(note.createdAt).isEqualTo(Instant.parse("2023-11-14T22:13:20Z"))
        assertThat(note.updatedAt).isEqualTo(Instant.parse("2023-11-14T22:15:00Z"))
    }

    @Test
    fun `Keep parser preserves nested checklist indentation from childListItems`() {
        val node = ObjectMapper().readTree(
            """
            {
              "title": "Nested",
              "listContent": [
                {
                  "text": "Parent",
                  "isChecked": false,
                  "childListItems": [
                    {"text": "Child A", "isChecked": true},
                    {
                      "text": "Child B",
                      "isChecked": false,
                      "childListItems": [
                        {"text": "Grandchild", "isChecked": false}
                      ]
                    }
                  ]
                },
                {"text": "Sibling", "isChecked": false}
              ]
            }
            """.trimIndent(),
        )

        val note = TakeoutNoteParser().parse(node)

        assertThat(note.items).containsExactly(
            TakeoutItem("Parent", false, 0),
            TakeoutItem("Child A", true, 1),
            TakeoutItem("Child B", false, 1),
            TakeoutItem("Grandchild", false, 2),
            TakeoutItem("Sibling", false, 0),
        )
    }

    @Test
    fun `Keep parser preserves text URLs and recognizes empty checklists`() {
        val mapper = ObjectMapper()
        val text = TakeoutNoteParser().parse(
            mapper.readTree("""{"textContent":"See https://example.com/x","color":"DEFAULT"}"""),
        )
        val emptyList = TakeoutNoteParser().parse(mapper.readTree("""{"title":"Empty","listContent":[]}"""))

        assertThat(text.type).isEqualTo(NoteType.TEXT)
        assertThat(text.content).isEqualTo("See https://example.com/x")
        assertThat(text.color).isEqualTo("#ffffff")
        assertThat(emptyList.type).isEqualTo(NoteType.LIST)
        assertThat(emptyList.items).isEmpty()
    }

    @Test
    fun `Keep parser maps each palette color to its Keep hex`() {
        val mapper = ObjectMapper()
        val expected = mapOf(
            "DEFAULT" to "#ffffff",
            "RED" to "#f28b82",
            "ORANGE" to "#fbbc04",
            "YELLOW" to "#fff475",
            "GREEN" to "#ccff90",
            "TEAL" to "#a7ffeb",
            "BLUE" to "#cbf0f8",
            "CERULEAN" to "#aecbfa",
            "PURPLE" to "#d7aefb",
            "PINK" to "#fdcfe8",
            "BROWN" to "#e6c9a8",
            "GRAY" to "#e8eaed",
        )

        expected.forEach { (name, hex) ->
            val note = TakeoutNoteParser().parse(mapper.readTree("""{"title":"$name","textContent":"x","color":"$name"}"""))
            assertThat(note.color).isEqualTo(hex)
        }
        assertThat(expected.values.distinct()).hasSize(expected.size)
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

private class MutableClock(var instant: Instant) : Clock() {
    override fun getZone() = ZoneOffset.UTC
    override fun withZone(zone: java.time.ZoneId) = this
    override fun instant() = instant
}
