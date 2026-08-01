import type { ChecklistItem, NoteType } from '../types'
import { base64ToBytes, bytesToBase64, decryptJson, encryptJson } from './aead'
import { aadNote, aadNoteKey, unwrapKey, wrapKey } from './keys'

export interface NotePlainPayload {
  v: 1
  title: string
  contentRaw: string
  items: Array<{
    id: string
    text: string
    checked: boolean
    sortOrder: number
    indent: number
  }>
  labelIds: string[]
}

export async function encryptNotePayload(
  noteId: string,
  noteKey: Uint8Array,
  payload: NotePlainPayload,
): Promise<string> {
  const blob = await encryptJson(noteKey, payload, aadNote(noteId))
  return bytesToBase64(blob)
}

export async function decryptNotePayload(
  noteId: string,
  noteKey: Uint8Array,
  ciphertextB64: string,
): Promise<NotePlainPayload> {
  const payload = await decryptJson<NotePlainPayload>(
    noteKey,
    base64ToBytes(ciphertextB64),
    aadNote(noteId),
  )
  if (payload.v !== 1) throw new Error(`Unsupported note payload version: ${payload.v}`)
  return payload
}

export async function wrapNoteKey(
  vaultKey: Uint8Array,
  noteId: string,
  noteKey: Uint8Array,
): Promise<string> {
  return bytesToBase64(await wrapKey(vaultKey, noteKey, aadNoteKey(noteId)))
}

export async function unwrapNoteKey(
  vaultKey: Uint8Array,
  noteId: string,
  wrappedNoteKeyB64: string,
): Promise<Uint8Array> {
  return unwrapKey(vaultKey, base64ToBytes(wrappedNoteKeyB64), aadNoteKey(noteId))
}

export function buildNotePayload(input: {
  title: string
  contentRaw: string
  items: ChecklistItem[]
  labelIds: string[]
  type: NoteType
}): NotePlainPayload {
  return {
    v: 1,
    title: input.title,
    contentRaw: input.type === 'TEXT' ? input.contentRaw : '',
    items:
      input.type === 'LIST'
        ? input.items.map((item) => ({
            id: item.id,
            text: item.text,
            checked: item.checked,
            sortOrder: item.sortOrder,
            indent: item.indent,
          }))
        : [],
    labelIds: input.labelIds,
  }
}
