package com.ownkeep.api.storage

import org.slf4j.LoggerFactory
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.io.InputStream

/** Opaque object store for encrypted attachment bytes. Keys are relative storage paths. */
interface AttachmentBlobStore {
    /** Stream upload; enforce [maxBytes] while copying; return actual size. */
    fun store(key: String, input: InputStream, maxBytes: Long): Long

    fun open(key: String): InputStream

    fun exists(key: String): Boolean

    fun delete(key: String)

    fun deleteAfterCommit(keys: Collection<String>)

    fun deleteOnRollback(key: String)
}

class AttachmentSizeLimitExceededException : RuntimeException("Attachment exceeds the configured size limit")

/**
 * Shared transaction-aware delete helpers. Concrete stores implement [delete], [store], [open], [exists].
 */
abstract class AbstractAttachmentBlobStore : AttachmentBlobStore {
    private val logger = LoggerFactory.getLogger(javaClass)

    final override fun deleteAfterCommit(keys: Collection<String>) {
        if (keys.isEmpty()) return
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            keys.forEach(::deleteBestEffort)
            return
        }
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() {
                keys.forEach(::deleteBestEffort)
            }
        })
    }

    final override fun deleteOnRollback(key: String) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) return
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCompletion(status: Int) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) deleteBestEffort(key)
            }
        })
    }

    protected fun deleteBestEffort(key: String) {
        try {
            delete(key)
        } catch (ex: Exception) {
            logger.warn("Could not delete attachment bytes at key {}", key, ex)
        }
    }
}
