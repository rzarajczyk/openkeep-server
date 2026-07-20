package com.openkeep.api

import com.fasterxml.jackson.databind.ObjectMapper
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.mock.web.MockMultipartFile
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OpenKeepPostgres(image: String) : PostgreSQLContainer<OpenKeepPostgres>(image)

@SpringBootTest(
    properties = [
        "openkeep.users-json=[{\"login\":\"alice\",\"password\":\"alice-password\"},{\"login\":\"bob\",\"password\":\"bob-password\"}]",
        "openkeep.token-ttl=1h",
        "openkeep.attachment.max-file-size=64",
        "openkeep.attachment.per-user-quota=32",
        "openkeep.login-rate-limit.max-attempts-per-ip=10000",
        "openkeep.login-rate-limit.max-attempts-per-login=10000",
    ],
)
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class OpenKeepIntegrationTest {
    @Autowired
    lateinit var mockMvc: MockMvc

    @Autowired
    lateinit var objectMapper: ObjectMapper

    @Autowired
    lateinit var authTokenRepository: AuthTokenRepository

    @Test
    fun `authentication note ownership search and deletion sync work end to end`() {
        val aliceToken = login("alice", "alice-password")
        val bobToken = login("bob", "bob-password")

        assertThat(authTokenRepository.findAll())
            .allMatch { it.tokenHash != aliceToken && it.tokenHash.length == 64 }

        val createResult = mockMvc.perform(
            post("/notes")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "type": "TEXT",
                      "title": "Private note",
                      "contentRaw": "**hello** <script>bad()</script>",
                      "backgroundColor": "#ffeeaa",
                      "pinned": true,
                      "labels": ["Private", "Imported"]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.pinned").value(true))
            .andExpect(jsonPath("$.labels[0]").value("Imported"))
            .andExpect(jsonPath("$.labels[1]").value("Private"))
            .andExpect(jsonPath("$.contentRendered").value(org.hamcrest.Matchers.containsString("<strong>hello</strong>")))
            .andExpect(jsonPath("$.contentRendered").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("<script"))))
            .andReturn()

        val noteId = objectMapper.readTree(createResult.response.contentAsString).get("id").asText()
        val createdVersion = objectMapper.readTree(createResult.response.contentAsString).get("version").asLong()

        mockMvc.perform(
            patch("/notes/$noteId")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "version": $createdVersion,
                      "labels": ["Private", "Work"]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.labels[0]").value("Private"))
            .andExpect(jsonPath("$.labels[1]").value("Work"))

        mockMvc.perform(get("/notes/$noteId").header("Authorization", "Bearer $bobToken"))
            .andExpect(status().isNotFound)
            .andExpect(jsonPath("$.code").value("note_not_found"))

        mockMvc.perform(
            get("/search")
                .header("Authorization", "Bearer $aliceToken")
                .param("q", "Private"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].id").value(noteId))

        val png = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        )
        val uploadResult = mockMvc.perform(
            multipart("/notes/$noteId/attachments")
                .file(MockMultipartFile("file", "../unsafe.png", "text/plain", png))
                .header("Authorization", "Bearer $aliceToken"),
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.kind").value("IMAGE"))
            .andExpect(jsonPath("$.mimeType").value("image/png"))
            .andExpect(jsonPath("$.originalFilename").value("unsafe.png"))
            .andReturn()
        val attachmentId = objectMapper.readTree(uploadResult.response.contentAsString).get("id").asText()

        mockMvc.perform(get("/attachments/$attachmentId").header("Authorization", "Bearer $bobToken"))
            .andExpect(status().isNotFound)

        mockMvc.perform(get("/attachments/$attachmentId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isOk)
            .andExpect(header().string("Content-Type", "image/png"))
            .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("inline")))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))

        mockMvc.perform(
            multipart("/notes/$noteId/attachments")
                .file(MockMultipartFile("file", "quota.bin", "application/octet-stream", ByteArray(17)))
                .header("Authorization", "Bearer $aliceToken"),
        )
            .andExpect(status().isPayloadTooLarge)
            .andExpect(jsonPath("$.code").value("quota_exceeded"))

        mockMvc.perform(
            multipart("/notes/$noteId/attachments")
                .file(MockMultipartFile("file", "large.bin", "application/octet-stream", ByteArray(65)))
                .header("Authorization", "Bearer $aliceToken"),
        )
            .andExpect(status().isPayloadTooLarge)
            .andExpect(jsonPath("$.code").value("file_too_large"))

        mockMvc.perform(delete("/notes/$noteId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isNoContent)

        mockMvc.perform(
            get("/notes")
                .header("Authorization", "Bearer $aliceToken")
                .param("updated_after", "1970-01-01T00:00:00Z"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.items").isEmpty)
            .andExpect(jsonPath("$.deletedIds[0]").value(noteId))

        mockMvc.perform(get("/notes/$noteId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isNotFound)
    }

    @Test
    fun `public health and protected me endpoints enforce authentication`() {
        mockMvc.perform(get("/health"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("UP"))

        mockMvc.perform(get("/openapi.json"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.paths['/auth/login']").exists())
            .andExpect(jsonPath("$.paths['/notes']").exists())

        mockMvc.perform(get("/me"))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("unauthorized"))

        mockMvc.perform(
            post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{not-json"),
        )
            .andExpect(status().isBadRequest)
            .andExpect(jsonPath("$.code").value("malformed_request"))
    }

    @Test
    fun `login includes the current user and logout revokes the token`() {
        val token = login("alice", "alice-password")

        mockMvc.perform(get("/me").header("Authorization", "Bearer $token"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.login").value("alice"))

        mockMvc.perform(post("/auth/logout").header("Authorization", "Bearer $token"))
            .andExpect(status().isNoContent)

        mockMvc.perform(get("/me").header("Authorization", "Bearer $token"))
            .andExpect(status().isUnauthorized)
    }

    @Test
    fun `list ordering search escaping and archive sync transitions are canonical`() {
        val token = login("alice", "alice-password")
        val created = mockMvc.perform(
            post("/notes")
                .header("Authorization", "Bearer $token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "type": "LIST",
                      "title": "Budget 100%",
                      "items": [
                        {"text": "First", "checked": false},
                        {"text": "Second", "checked": true}
                      ]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.items[0].text").value("First"))
            .andExpect(jsonPath("$.items[0].sortOrder").value(0))
            .andExpect(jsonPath("$.items[1].text").value("Second"))
            .andExpect(jsonPath("$.items[1].sortOrder").value(1))
            .andReturn()

        val createdJson = objectMapper.readTree(created.response.contentAsString)
        val noteId = createdJson.get("id").asText()
        val updatedAt = createdJson.get("updatedAt").asText()
        val version = createdJson.get("version").asLong()
        val firstItemId = createdJson.path("items").path(0).path("id").asText()
        val secondItemId = createdJson.path("items").path(1).path("id").asText()

        mockMvc.perform(
            get("/search")
                .header("Authorization", "Bearer $token")
                .param("q", "%"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[?(@.id == '$noteId')]").isNotEmpty)

        mockMvc.perform(
            patch("/notes/$noteId")
                .header("Authorization", "Bearer $token")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "archived": true,
                      "version": $version,
                      "items": [
                        {"id": "$firstItemId", "text": "First", "checked": false, "sortOrder": 0},
                        {"id": "$secondItemId", "text": "Second", "checked": true, "sortOrder": 1}
                      ]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.archived").value(true))
            .andExpect(jsonPath("$.items[0].id").value(firstItemId))
            .andExpect(jsonPath("$.items[1].id").value(secondItemId))

        mockMvc.perform(
            patch("/notes/$noteId")
                .header("Authorization", "Bearer $token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"title":"stale write","version":$version}"""),
        )
            .andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("version_conflict"))

        mockMvc.perform(
            get("/notes")
                .header("Authorization", "Bearer $token")
                .param("updated_after", updatedAt)
                .param("after_id", noteId),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.items[?(@.id == '$noteId' && @.archived == true)]").isNotEmpty)

        mockMvc.perform(
            get("/notes")
                .header("Authorization", "Bearer $token")
                .param("updated_after", updatedAt)
                .param("after_id", noteId)
                .param("archived", "true"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.items[?(@.id == '$noteId')]").isNotEmpty)
    }

    @Test
    fun `Google Keep ZIP import is asynchronous private and repeatable`() {
        val aliceToken = login("alice", "alice-password")
        val bobToken = login("bob", "bob-password")
        val title = "Takeout-${UUID.randomUUID()}"
        val archive = keepArchive(
            mapOf(
                "Takeout/Keep/note.json" to
                    """
                    {
                      "title": "$title",
                      "textContent": "Visit https://example.com/imported",
                      "color": "GREEN",
                      "isArchived": true,
                      "isPinned": true,
                      "createdTimestampUsec": "1700000000000000",
                      "userEditedTimestampUsec": "1700000100000000",
                      "labels": [{"name": "Takeout"}],
                      "attachments": [{"filePath": "photo.jpg", "mimetype": "image/jpeg"}],
                      "annotations": [{"webLink": {"url": "https://ignored.example"}}],
                      "sharees": [{"email": "ignored@example.com"}]
                    }
                    """.trimIndent().toByteArray(),
                "Takeout/Keep/photo.jpg" to byteArrayOf(
                    0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xe0.toByte(),
                    0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
                ),
                "Takeout/Keep/trashed.json" to
                    """{"title":"Do not import","textContent":"trash","isTrashed":true}""".toByteArray(),
            ),
        )

        val firstJob = submitImport(aliceToken, archive)
        mockMvc.perform(get("/imports/google-keep/$firstJob").header("Authorization", "Bearer $bobToken"))
            .andExpect(status().isNotFound)
        awaitImport(aliceToken, firstJob)
            .also {
                assertThat(it.path("status").asText()).isEqualTo("COMPLETED")
                assertThat(it.path("progressPercent").asInt()).isEqualTo(100)
                assertThat(it.path("importedNotes").asInt()).isEqualTo(1)
                assertThat(it.path("skippedNotes").asInt()).isEqualTo(1)
                assertThat(it.path("warningCount").asInt()).isEqualTo(1)
            }

        awaitImport(aliceToken, submitImport(aliceToken, archive))
        val search = mockMvc.perform(
            get("/search")
                .header("Authorization", "Bearer $aliceToken")
                .param("q", title),
        ).andExpect(status().isOk).andReturn()
        val matches = objectMapper.readTree(search.response.contentAsString).filter { it.path("title").asText() == title }

        assertThat(matches).hasSize(2)
        assertThat(matches).allSatisfy {
            assertThat(it.path("pinned").asBoolean()).isTrue()
            assertThat(it.path("archived").asBoolean()).isTrue()
            assertThat(it.path("backgroundColor").asText()).isEqualTo("#ccff90")
            assertThat(it.path("labels").map { label -> label.asText() }).containsExactly("Takeout")
            assertThat(it.path("attachments").size()).isEqualTo(1)
            assertThat(it.path("contentRaw").asText()).contains("https://example.com/imported")
            assertThat(it.path("contentRaw").asText()).doesNotContain("ignored.example")
        }
    }

    @Test
    fun `Google Keep import rejects ZIP traversal paths`() {
        val token = login("alice", "alice-password")
        val archive = keepArchive(
            mapOf(
                "Takeout/Keep/../../escape.json" to
                    """{"title":"Unsafe","textContent":"must not import"}""".toByteArray(),
            ),
        )

        val result = awaitImport(token, submitImport(token, archive))

        assertThat(result.path("status").asText()).isEqualTo("FAILED")
        assertThat(result.path("importedNotes").asInt()).isZero()
        assertThat(result.path("errorMessage").asText()).contains("unsafe path")
    }

    private fun login(login: String, password: String): String {
        val result = mockMvc.perform(
            post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(mapOf("login" to login, "password" to password))),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.token").isString)
            .andExpect(jsonPath("$.user.login").value(login))
            .andReturn()
        return objectMapper.readTree(result.response.contentAsString).get("token").asText()
    }

    private fun submitImport(token: String, archive: ByteArray): String {
        val result = mockMvc.perform(
            multipart("/imports/google-keep")
                .file(MockMultipartFile("file", "takeout.zip", "application/zip", archive))
                .header("Authorization", "Bearer $token"),
        )
            .andExpect(status().isAccepted)
            .andExpect(jsonPath("$.status").value("VALIDATING"))
            .andReturn()
        return objectMapper.readTree(result.response.contentAsString).path("jobId").asText()
    }

    private fun awaitImport(token: String, jobId: String): com.fasterxml.jackson.databind.JsonNode {
        repeat(100) {
            val result = mockMvc.perform(
                get("/imports/google-keep/$jobId").header("Authorization", "Bearer $token"),
            ).andExpect(status().isOk).andReturn()
            val body = objectMapper.readTree(result.response.contentAsString)
            if (body.path("status").asText() in setOf("COMPLETED", "FAILED")) return body
            Thread.sleep(50)
        }
        throw AssertionError("Import job did not finish")
    }

    private fun keepArchive(entries: Map<String, ByteArray>): ByteArray {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            entries.forEach { (name, content) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(content)
                zip.closeEntry()
            }
        }
        return bytes.toByteArray()
    }

    companion object {
        private val storageRoot = Files.createTempDirectory("openkeep-integration-")

        @Container
        @JvmStatic
        val postgres = OpenKeepPostgres("postgres:18-alpine")

        @DynamicPropertySource
        @JvmStatic
        fun databaseProperties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("openkeep.attachment.storage-root") { storageRoot.toString() }
        }
    }
}
