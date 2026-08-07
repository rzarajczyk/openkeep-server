package com.ownkeep.api.storage

import com.google.cloud.storage.BlobId
import com.google.cloud.storage.BlobInfo
import com.google.cloud.storage.Storage
import java.io.InputStream
import java.nio.channels.Channels

class GcsAttachmentBlobStore(
    private val storage: Storage,
    private val bucket: String,
    prefix: String = "",
) : AbstractAttachmentBlobStore() {
    private val prefix: String = prefix.trim().trimStart('/').let { p ->
        when {
            p.isEmpty() -> ""
            p.endsWith("/") -> p
            else -> "$p/"
        }
    }

    override fun store(key: String, input: InputStream, maxBytes: Long): Long {
        val objectName = objectName(key)
        val blobInfo = BlobInfo.newBuilder(bucket, objectName).build()
        var written = 0L
        try {
            storage.writer(blobInfo).use { writer ->
                Channels.newOutputStream(writer).use { output ->
                    input.use { source ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = source.read(buffer)
                            if (read < 0) break
                            written += read
                            if (written > maxBytes) {
                                throw AttachmentSizeLimitExceededException()
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
            }
            return written
        } catch (ex: Exception) {
            deleteBestEffort(key)
            throw ex
        }
    }

    override fun open(key: String): InputStream {
        val blob = storage.get(BlobId.of(bucket, objectName(key)))
            ?: throw NoSuchElementException("Attachment bytes missing for key $key")
        return Channels.newInputStream(blob.reader())
    }

    override fun exists(key: String): Boolean {
        val blob = storage.get(BlobId.of(bucket, objectName(key))) ?: return false
        return blob.exists()
    }

    override fun delete(key: String) {
        storage.delete(BlobId.of(bucket, objectName(key)))
    }

    internal fun objectName(key: String): String = prefix + key.trimStart('/')
}
