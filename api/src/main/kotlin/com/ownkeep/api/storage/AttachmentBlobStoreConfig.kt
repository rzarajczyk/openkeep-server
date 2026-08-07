package com.ownkeep.api.storage

import com.google.cloud.storage.StorageOptions
import com.ownkeep.api.OwnKeepProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AttachmentBlobStoreConfig {
    @Bean
    @ConditionalOnProperty(
        prefix = "ownkeep.attachment",
        name = ["storage"],
        havingValue = "filesystem",
        matchIfMissing = true,
    )
    fun filesystemAttachmentBlobStore(properties: OwnKeepProperties): AttachmentBlobStore =
        FilesystemAttachmentBlobStore(properties.attachment.storageRoot)

    @Bean
    @ConditionalOnProperty(prefix = "ownkeep.attachment", name = ["storage"], havingValue = "gcs")
    fun gcsAttachmentBlobStore(properties: OwnKeepProperties): AttachmentBlobStore {
        val bucket = properties.attachment.gcs.bucket.trim()
        require(bucket.isNotEmpty()) {
            "ownkeep.attachment.gcs.bucket (OWNKEEP_ATTACHMENT_GCS_BUCKET) is required when storage=gcs"
        }
        val storage = StorageOptions.getDefaultInstance().service
        return GcsAttachmentBlobStore(
            storage = storage,
            bucket = bucket,
            prefix = properties.attachment.gcs.prefix,
        )
    }
}
