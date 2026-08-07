package com.openkeep.api.storage

import com.google.cloud.storage.StorageOptions
import com.openkeep.api.OpenKeepProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AttachmentBlobStoreConfig {
    @Bean
    @ConditionalOnProperty(
        prefix = "openkeep.attachment",
        name = ["storage"],
        havingValue = "filesystem",
        matchIfMissing = true,
    )
    fun filesystemAttachmentBlobStore(properties: OpenKeepProperties): AttachmentBlobStore =
        FilesystemAttachmentBlobStore(properties.attachment.storageRoot)

    @Bean
    @ConditionalOnProperty(prefix = "openkeep.attachment", name = ["storage"], havingValue = "gcs")
    fun gcsAttachmentBlobStore(properties: OpenKeepProperties): AttachmentBlobStore {
        val bucket = properties.attachment.gcs.bucket.trim()
        require(bucket.isNotEmpty()) {
            "openkeep.attachment.gcs.bucket (OPENKEEP_ATTACHMENT_GCS_BUCKET) is required when storage=gcs"
        }
        val storage = StorageOptions.getDefaultInstance().service
        return GcsAttachmentBlobStore(
            storage = storage,
            bucket = bucket,
            prefix = properties.attachment.gcs.prefix,
        )
    }
}
