package com.openkeep.api.storage

import java.io.InputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

class FilesystemAttachmentBlobStore(storageRoot: Path) : AbstractAttachmentBlobStore() {
    private val root: Path = storageRoot.toAbsolutePath().normalize()
    private val tempRoot: Path = root.resolve(".tmp")

    init {
        Files.createDirectories(tempRoot)
    }

    override fun store(key: String, input: InputStream, maxBytes: Long): Long {
        val destination = resolveSafe(key)
        val temp = Files.createTempFile(tempRoot, "upload-", ".tmp")
        try {
            val actualSize = copyWithLimit(input, temp, maxBytes)
            Files.createDirectories(destination.parent)
            try {
                Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp, destination, StandardCopyOption.REPLACE_EXISTING)
            }
            return actualSize
        } catch (ex: Exception) {
            Files.deleteIfExists(temp)
            Files.deleteIfExists(destination)
            throw ex
        }
    }

    override fun open(key: String): InputStream {
        val path = resolveSafe(key)
        if (!Files.isRegularFile(path)) {
            throw NoSuchElementException("Attachment bytes missing for key $key")
        }
        return Files.newInputStream(path)
    }

    override fun exists(key: String): Boolean = Files.isRegularFile(resolveSafe(key))

    override fun delete(key: String) {
        Files.deleteIfExists(resolveSafe(key))
    }

    internal fun resolveSafe(key: String): Path {
        val path = root.resolve(key).normalize()
        if (!path.startsWith(root)) {
            throw IllegalArgumentException("Unsafe attachment storage path")
        }
        return path
    }

    private fun copyWithLimit(input: InputStream, temp: Path, maxBytes: Long): Long {
        var total = 0L
        input.use { source ->
            Files.newOutputStream(temp, StandardOpenOption.TRUNCATE_EXISTING).use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maxBytes) {
                        throw AttachmentSizeLimitExceededException()
                    }
                    output.write(buffer, 0, read)
                }
            }
        }
        return total
    }
}
