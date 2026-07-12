package com.openkeep.api

import jakarta.persistence.LockModeType
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface UserRepository : JpaRepository<UserEntity, Long> {
    fun findByLogin(login: String): UserEntity?
    fun findAllByLoginIn(logins: Collection<String>): List<UserEntity>

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserEntity u where u.id = :id")
    fun findForUpdateById(@Param("id") id: Long): UserEntity?
}

interface AuthTokenRepository : JpaRepository<AuthTokenEntity, UUID> {
    fun findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(tokenHash: String, now: Instant): AuthTokenEntity?

    @Modifying
    @Query("update AuthTokenEntity t set t.revokedAt = :now where t.tokenHash = :hash and t.revokedAt is null")
    fun revoke(@Param("hash") hash: String, @Param("now") now: Instant): Int

    @Modifying
    @Query("delete from AuthTokenEntity t where t.expiresAt < :before or t.revokedAt < :before")
    fun deleteExpiredAndRevokedBefore(@Param("before") before: Instant): Int
}

interface NoteRepository : JpaRepository<NoteEntity, UUID> {
    fun findByIdAndUserIdAndDeletedAtIsNull(id: UUID, userId: Long): NoteEntity?

    @Query(
        value = """
            select * from notes n
            where n.user_id = :userId
              and (n.updated_at > :updatedAfter or
                   (n.updated_at = :updatedAfter and n.id > :afterId))
              and (n.deleted_at is not null or :archived is null or n.is_archived = :archived)
            order by n.updated_at asc, n.id asc
        """,
        nativeQuery = true,
    )
    fun findSyncPage(
        @Param("userId") userId: Long,
        @Param("updatedAfter") updatedAfter: Instant,
        @Param("afterId") afterId: UUID,
        @Param("archived") archived: Boolean?,
        pageable: Pageable,
    ): List<NoteEntity>

    @Query(
        value = """
            select distinct n.* from notes n
            where n.user_id = :userId
              and n.deleted_at is null
              and (
                lower(n.title) like lower(:pattern) escape '\'
                or lower(n.content_raw) like lower(:pattern) escape '\'
                or exists (
                    select 1 from note_items i
                    where i.note_id = n.id
                      and lower(i.text) like lower(:pattern) escape '\'
                )
              )
            order by n.updated_at desc, n.id desc
        """,
        nativeQuery = true,
    )
    fun search(
        @Param("userId") userId: Long,
        @Param("pattern") pattern: String,
        pageable: Pageable,
    ): List<NoteEntity>
}

interface NoteItemRepository : JpaRepository<NoteItemEntity, UUID> {
    fun findAllByNoteIdOrderBySortOrderAscIdAsc(noteId: UUID): List<NoteItemEntity>

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from NoteItemEntity i where i.noteId = :noteId")
    fun deleteAllByNoteId(@Param("noteId") noteId: UUID): Int
}

interface AttachmentRepository : JpaRepository<AttachmentEntity, UUID> {
    fun findAllByNoteIdOrderByCreatedAtAscIdAsc(noteId: UUID): List<AttachmentEntity>

    @Query(
        """
            select a from AttachmentEntity a, NoteEntity n
            where a.id = :id and a.noteId = n.id
              and n.userId = :userId and n.deletedAt is null
        """,
    )
    fun findOwned(@Param("id") id: UUID, @Param("userId") userId: Long): AttachmentEntity?

    @Query(
        """
            select coalesce(sum(a.sizeBytes), 0) from AttachmentEntity a, NoteEntity n
            where a.noteId = n.id and n.userId = :userId
        """,
    )
    fun totalBytesForUser(@Param("userId") userId: Long): Long

    @Modifying
    fun deleteAllByNoteId(noteId: UUID): Int
}
