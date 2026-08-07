package com.ownkeep.api

import com.fasterxml.jackson.databind.ObjectMapper
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.mock.web.MockMultipartFile
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.util.Base64
import java.util.UUID

class OwnKeepPostgres(image: String) : PostgreSQLContainer<OwnKeepPostgres>(image)

@SpringBootTest(
    properties = [
        "ownkeep.admin-username=alice",
        "ownkeep.admin-password=alice-password",
        "ownkeep.token-ttl=1h",
        "ownkeep.attachment.max-file-size=1024",
        "ownkeep.attachment.per-user-quota=4096",
        "ownkeep.login-rate-limit.max-attempts-per-ip=10000",
        "ownkeep.login-rate-limit.max-attempts-per-login=10000",
    ],
)
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class OwnKeepIntegrationTest {
    @Autowired
    lateinit var mockMvc: MockMvc

    @Autowired
    lateinit var objectMapper: ObjectMapper

    @Autowired
    lateinit var userRepository: UserRepository

    @Autowired
    lateinit var passwordEncoder: org.springframework.security.crypto.password.PasswordEncoder

    @org.junit.jupiter.api.BeforeEach
    fun ensureBobUser() {
        val existing = userRepository.findByLogin("bob")
        val now = java.time.Instant.now()
        if (existing == null) {
            userRepository.save(
                UserEntity(
                    login = "bob",
                    passwordHash = passwordEncoder.encode("bob-password"),
                    enabled = true,
                    role = UserRole.USER,
                    createdAt = now,
                    updatedAt = now,
                ),
            )
        } else {
            existing.enabled = true
            existing.role = UserRole.USER
            existing.passwordHash = passwordEncoder.encode("bob-password")
            existing.updatedAt = now
            // reset vault between tests
            existing.kdfSalt = null
            existing.kdfParams = null
            existing.wrappedVaultKey = null
            existing.wrappedVaultKeyRecovery = null
            existing.vaultInitializedAt = null
            userRepository.save(existing)
        }
        userRepository.findByLogin("alice")?.let { alice ->
            alice.passwordHash = passwordEncoder.encode("alice-password")
            alice.kdfSalt = null
            alice.kdfParams = null
            alice.wrappedVaultKey = null
            alice.wrappedVaultKeyRecovery = null
            alice.vaultInitializedAt = null
            userRepository.save(alice)
        }
    }

    @Test
    fun `vault init encrypted note ownership and opaque attachment work end to end`() {
        val aliceToken = login("alice", "alice-password")
        val bobToken = login("bob", "bob-password")

        mockMvc.perform(get("/me").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.vault.initialized").value(false))

        val salt = b64(ByteArray(16) { 1 })
        val wrap = b64(ByteArray(48) { 2 })
        val recovery = b64(ByteArray(48) { 3 })
        mockMvc.perform(
            post("/me/vault")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "kdfSalt": "$salt",
                      "kdfParams": {"alg":"argon2id","m":65536,"t":3,"p":1},
                      "wrappedVaultKey": "$wrap",
                      "wrappedVaultKeyRecovery": "$recovery"
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.initialized").value(true))

        val labelCipher = b64(ByteArray(48) { 4 })
        val labelResult = mockMvc.perform(
            post("/labels")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"ciphertext":"$labelCipher"}"""),
        )
            .andExpect(status().isOk)
            .andReturn()
        val labelId = objectMapper.readTree(labelResult.response.contentAsString).get("id").asText()

        val noteId = UUID.randomUUID()
        val noteCipher = b64(ByteArray(64) { 5 })
        val noteKeyWrap = b64(ByteArray(48) { 6 })
        val createResult = mockMvc.perform(
            post("/notes")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "id": "$noteId",
                      "type": "TEXT",
                      "backgroundColor": "#ffeeaa",
                      "pinned": true,
                      "wrappedNoteKey": "$noteKeyWrap",
                      "ciphertext": "$noteCipher",
                      "labelIds": ["$labelId"]
                    }
                    """.trimIndent(),
                ),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value(noteId.toString()))
            .andExpect(jsonPath("$.pinned").value(true))
            .andExpect(jsonPath("$.ciphertext").value(noteCipher))
            .andExpect(jsonPath("$.labelIds[0]").value(labelId))
            .andExpect(jsonPath("$.title").doesNotExist())
            .andReturn()

        val version = objectMapper.readTree(createResult.response.contentAsString).get("version").asLong()

        mockMvc.perform(get("/notes/$noteId").header("Authorization", "Bearer $bobToken"))
            .andExpect(status().isNotFound)

        mockMvc.perform(get("/search").header("Authorization", "Bearer $aliceToken").param("q", "x"))
            .andExpect(status().isNotFound)

        mockMvc.perform(get("/markdown/preview").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isNotFound)

        val attachmentId = UUID.randomUUID()
        val meta = b64(ByteArray(48) { 7 })
        mockMvc.perform(
            multipart("/notes/$noteId/attachments")
                .file(MockMultipartFile("file", "secret.bin", "application/octet-stream", ByteArray(16) { 9 }))
                .file(MockMultipartFile("metaCiphertext", null, "text/plain", meta.toByteArray()))
                .file(MockMultipartFile("attachmentId", null, "text/plain", attachmentId.toString().toByteArray()))
                .header("Authorization", "Bearer $aliceToken"),
        )
            .andExpect(status().isCreated)
            .andExpect(jsonPath("$.id").value(attachmentId.toString()))
            .andExpect(jsonPath("$.metaCiphertext").value(meta))
            .andExpect(jsonPath("$.originalFilename").doesNotExist())

        mockMvc.perform(get("/attachments/$attachmentId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isOk)

        val afterUpload = mockMvc.perform(get("/notes/$noteId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isOk)
            .andReturn()
        val currentVersion = objectMapper.readTree(afterUpload.response.contentAsString).get("version").asLong()
        assertThat(currentVersion).isGreaterThanOrEqualTo(version)

        mockMvc.perform(
            patch("/notes/$noteId")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"version":$currentVersion,"archived":true}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.archived").value(true))
            .andExpect(jsonPath("$.ciphertext").value(noteCipher))

        mockMvc.perform(delete("/notes/$noteId").header("Authorization", "Bearer $aliceToken"))
            .andExpect(status().isNoContent)

        mockMvc.perform(
            get("/notes")
                .header("Authorization", "Bearer $aliceToken")
                .param("updated_after", "1970-01-01T00:00:00Z"),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.deletedIds[0]").value(noteId.toString()))
    }

    @Test
    fun `password change requires vault wrap and admin reset clears password wrap`() {
        val aliceToken = login("alice", "alice-password")
        val salt = b64(ByteArray(16) { 1 })
        val wrap = b64(ByteArray(48) { 2 })
        val recovery = b64(ByteArray(48) { 3 })
        mockMvc.perform(
            post("/me/vault")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "kdfSalt": "$salt",
                      "kdfParams": {"alg":"argon2id","m":65536,"t":3,"p":1},
                      "wrappedVaultKey": "$wrap",
                      "wrappedVaultKeyRecovery": "$recovery"
                    }
                    """.trimIndent(),
                ),
        ).andExpect(status().isOk)

        val newWrap = b64(ByteArray(48) { 8 })
        mockMvc.perform(
            patch("/me/password")
                .header("Authorization", "Bearer $aliceToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "currentPassword":"alice-password",
                      "newPassword":"alice-password-2",
                      "wrappedVaultKey":"$newWrap"
                    }
                    """.trimIndent(),
                ),
        ).andExpect(status().isNoContent)

        val aliceAfter = login("alice", "alice-password-2")
        val bobToken = login("bob", "bob-password")
        // promote bob temporarily? alice is admin - reset bob after bob has vault
        val bobWrap = b64(ByteArray(48) { 11 })
        val bobRecovery = b64(ByteArray(48) { 12 })
        mockMvc.perform(
            post("/me/vault")
                .header("Authorization", "Bearer $bobToken")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    """
                    {
                      "kdfSalt": "$salt",
                      "kdfParams": {"alg":"argon2id","m":65536,"t":3,"p":1},
                      "wrappedVaultKey": "$bobWrap",
                      "wrappedVaultKeyRecovery": "$bobRecovery"
                    }
                    """.trimIndent(),
                ),
        ).andExpect(status().isOk)

        val bobId = userRepository.findByLogin("bob")!!.id!!
        mockMvc.perform(
            post("/users/$bobId/reset-password")
                .header("Authorization", "Bearer $aliceAfter")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"newPassword":"bob-password-reset"}"""),
        ).andExpect(status().isNoContent)

        val bobAfterReset = login("bob", "bob-password-reset")
        mockMvc.perform(get("/me").header("Authorization", "Bearer $bobAfterReset"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.vault.needsRecoveryUnlock").value(true))
            .andExpect(jsonPath("$.vault.hasRecoveryKey").value(true))

        val rebound = b64(ByteArray(48) { 13 })
        mockMvc.perform(
            put("/me/vault/wrap")
                .header("Authorization", "Bearer $bobAfterReset")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"wrappedVaultKey":"$rebound"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.needsRecoveryUnlock").value(false))

        assertThat(userRepository.findByLogin("bob")!!.wrappedVaultKey).isNotNull()
    }

    @Test
    fun `api prefix is stripped for health and login`() {
        mockMvc.perform(get("/api/health"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("UP"))

        mockMvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"login":"alice","password":"alice-password"}"""),
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.token").isString)
    }

    private fun login(login: String, password: String): String {
        val result = mockMvc.perform(
            post("/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""{"login":"$login","password":"$password"}"""),
        )
            .andExpect(status().isOk)
            .andReturn()
        return objectMapper.readTree(result.response.contentAsString).get("token").asText()
    }

    private fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    companion object {
        @Container
        @JvmStatic
        val postgres = OwnKeepPostgres("postgres:16-alpine")

        @JvmStatic
        @DynamicPropertySource
        fun datasource(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
            registry.add("ownkeep.attachment.storage-root") {
                java.nio.file.Files.createTempDirectory("ownkeep-att").toString()
            }
        }
    }
}
