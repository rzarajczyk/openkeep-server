import type { AttachmentKind } from '../types'
import {
  base64ToBytes,
  bytesToBase64,
  decryptAesGcm,
  decryptJson,
  encryptAesGcm,
  encryptJson,
} from './aead'
import { aadAttachment, aadAttachmentMeta } from './keys'

export interface AttachmentMetaPayload {
  v: 1
  originalFilename: string
  mimeType: string
  kind: AttachmentKind
}

export async function encryptAttachmentMeta(
  noteKey: Uint8Array,
  attachmentId: string,
  meta: Omit<AttachmentMetaPayload, 'v'>,
): Promise<string> {
  const blob = await encryptJson(
    noteKey,
    { v: 1, ...meta } satisfies AttachmentMetaPayload,
    aadAttachmentMeta(attachmentId),
  )
  return bytesToBase64(blob)
}

export async function decryptAttachmentMeta(
  noteKey: Uint8Array,
  attachmentId: string,
  metaCiphertextB64: string,
): Promise<AttachmentMetaPayload> {
  const payload = await decryptJson<AttachmentMetaPayload>(
    noteKey,
    base64ToBytes(metaCiphertextB64),
    aadAttachmentMeta(attachmentId),
  )
  if (payload.v !== 1) throw new Error(`Unsupported attachment meta version: ${payload.v}`)
  return payload
}

export async function encryptAttachmentBytes(
  noteKey: Uint8Array,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return encryptAesGcm(noteKey, bytes, aadAttachment(attachmentId))
}

export async function decryptAttachmentBytes(
  noteKey: Uint8Array,
  attachmentId: string,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  return decryptAesGcm(noteKey, ciphertext, aadAttachment(attachmentId))
}

export function inferAttachmentKind(mimeType: string): AttachmentKind {
  return mimeType.startsWith('image/') ? 'IMAGE' : 'FILE'
}
