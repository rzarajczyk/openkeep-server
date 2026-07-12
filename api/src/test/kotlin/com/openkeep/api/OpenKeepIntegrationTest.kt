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
import java.nio.file.Files
import java.util.UUID

class OpenKeepPostgres(image: String) : PostgreSQLContainer<OpenKeepPostgres>(image)

@SpringBootTest(
    properties = [
        "openkeep.users-json=[{\"login\":\"alice\",\"password\":\"alice-password\"},{\"login\":\"bob\",\"password\":\"bob-password\"}]",
        "openkeep.token-ttl=1h",
        "openkeep.attachment.max-file-size=64",
        "openkeep.attachment.per-user-quota=32",
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
                      "backgroundColor": "#ffeeaa"
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.contentRendered").value(org.hamcrest.Matchers.containsString("<strong>hello</strong>")))
            .andExpect(jsonPath("$.contentRendered").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("<script"))))
            .andReturn()

        val noteId = objectMapper.readTree(createResult.response.contentAsString).get("id").asText()

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
