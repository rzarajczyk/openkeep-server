package com.openkeep.api.storage

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayInputStream
import java.nio.file.Files
import java.nio.file.Path

class FilesystemAttachmentBlobStoreTest {
    @TempDir
    lateinit var root: Path

    private lateinit var store: FilesystemAttachmentBlobStore

    @BeforeEach
    fun setUp() {
        store = FilesystemAttachmentBlobStore(root)
    }

    @Test
    fun `store open exists and delete round trip`() {
        val key = "1/note-id/att-id"
        val bytes = "cipher-bytes".toByteArray()
        val size = store.store(key, ByteArrayInputStream(bytes), maxBytes = 1024)
        assertThat(size).isEqualTo(bytes.size.toLong())
        assertThat(store.exists(key)).isTrue()
        assertThat(store.open(key).readAllBytes()).isEqualTo(bytes)
        store.delete(key)
        assertThat(store.exists(key)).isFalse()
    }

    @Test
    fun `store rejects oversize payload`() {
        val key = "1/n/a"
        assertThatThrownBy {
            store.store(key, ByteArrayInputStream(ByteArray(32)), maxBytes = 16)
        }.isInstanceOf(AttachmentSizeLimitExceededException::class.java)
        assertThat(store.exists(key)).isFalse()
        assertThat(Files.list(root.resolve(".tmp")).use { it.count() }).isZero()
    }

    @Test
    fun `path traversal is rejected`() {
        assertThatThrownBy {
            store.resolveSafe("../outside")
        }.isInstanceOf(IllegalArgumentException::class.java)
            .hasMessageContaining("Unsafe")
    }

    @Test
    fun `deleteAfterCommit without transaction deletes immediately`() {
        val key = "1/n/a"
        store.store(key, ByteArrayInputStream(byteArrayOf(1, 2, 3)), maxBytes = 10)
        store.deleteAfterCommit(listOf(key))
        assertThat(store.exists(key)).isFalse()
    }
}
