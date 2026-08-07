package com.openkeep.api.storage

import com.google.cloud.ReadChannel
import com.google.cloud.WriteChannel
import com.google.cloud.storage.Blob
import com.google.cloud.storage.BlobId
import com.google.cloud.storage.BlobInfo
import com.google.cloud.storage.Storage
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.atLeastOnce
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

class GcsAttachmentBlobStoreTest {
    @Test
    fun `objectName applies prefix`() {
        val store = GcsAttachmentBlobStore(mock(), bucket = "b", prefix = "openkeep")
        assertThat(store.objectName("1/n/a")).isEqualTo("openkeep/1/n/a")
    }

    @Test
    fun `store writes object and returns size`() {
        val sink = ByteArrayOutputStream()
        val writeChannel = mock<WriteChannel> {
            on { write(any()) } doAnswer { invocation ->
                val src = invocation.getArgument<ByteBuffer>(0)
                val bytes = ByteArray(src.remaining())
                src.get(bytes)
                sink.write(bytes)
                bytes.size
            }
            on { isOpen } doReturn true
        }
        val storage = mock<Storage> {
            on { writer(any<BlobInfo>()) } doReturn writeChannel
        }
        val store = GcsAttachmentBlobStore(storage, bucket = "attachments", prefix = "ok/")
        val payload = "hello-gcs".toByteArray()
        val size = store.store("u/n/a", ByteArrayInputStream(payload), maxBytes = 100)
        assertThat(size).isEqualTo(payload.size.toLong())
        assertThat(sink.toByteArray()).isEqualTo(payload)

        val infoCaptor = argumentCaptor<BlobInfo>()
        verify(storage).writer(infoCaptor.capture())
        assertThat(infoCaptor.firstValue.blobId).isEqualTo(BlobId.of("attachments", "ok/u/n/a"))
        verify(writeChannel, atLeastOnce()).close()
    }

    @Test
    fun `store over size limit deletes partial object`() {
        val writeChannel = mock<WriteChannel> {
            on { write(any()) } doAnswer { invocation ->
                val src = invocation.getArgument<ByteBuffer>(0)
                val n = src.remaining()
                src.position(src.limit())
                n
            }
            on { isOpen } doReturn true
        }
        val storage = mock<Storage> {
            on { writer(any<BlobInfo>()) } doReturn writeChannel
            on { delete(any<BlobId>()) } doReturn true
        }
        val store = GcsAttachmentBlobStore(storage, bucket = "attachments")
        assertThatThrownBy {
            store.store("u/n/a", ByteArrayInputStream(ByteArray(64)), maxBytes = 8)
        }.isInstanceOf(AttachmentSizeLimitExceededException::class.java)
        verify(storage).delete(BlobId.of("attachments", "u/n/a"))
    }

    @Test
    fun `exists and open use storage client`() {
        val payload = "data".toByteArray()
        val source = ByteArrayInputStream(payload)
        val readChannel = mock<ReadChannel> {
            on { read(any()) } doAnswer { invocation ->
                val dst = invocation.getArgument<ByteBuffer>(0)
                val buf = ByteArray(dst.remaining())
                val n = source.read(buf)
                if (n < 0) -1 else {
                    dst.put(buf, 0, n)
                    n
                }
            }
            on { isOpen } doReturn true
        }
        val blob = mock<Blob> {
            on { exists() } doReturn true
            on { reader() } doReturn readChannel
        }
        val storage = mock<Storage> {
            on { get(eq(BlobId.of("attachments", "u/n/a"))) } doReturn blob
        }
        val store = GcsAttachmentBlobStore(storage, bucket = "attachments")
        assertThat(store.exists("u/n/a")).isTrue()
        assertThat(store.open("u/n/a").readAllBytes()).isEqualTo(payload)
    }

    @Test
    fun `open missing blob throws`() {
        val storage = mock<Storage> {
            on { get(any<BlobId>()) } doReturn null
        }
        val store = GcsAttachmentBlobStore(storage, bucket = "attachments")
        assertThatThrownBy { store.open("missing") }
            .isInstanceOf(NoSuchElementException::class.java)
    }
}
