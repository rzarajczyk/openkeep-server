import { base64ToBytes, bytesToBase64, decryptJson, encryptJson } from './aead'
import { AAD_LABEL } from './keys'

export interface LabelPlainPayload {
  v: 1
  name: string
}

export async function encryptLabelName(vaultKey: Uint8Array, name: string): Promise<string> {
  const blob = await encryptJson(vaultKey, { v: 1, name } satisfies LabelPlainPayload, AAD_LABEL)
  return bytesToBase64(blob)
}

export async function decryptLabelName(vaultKey: Uint8Array, ciphertextB64: string): Promise<string> {
  const payload = await decryptJson<LabelPlainPayload>(
    vaultKey,
    base64ToBytes(ciphertextB64),
    AAD_LABEL,
  )
  if (payload.v !== 1) throw new Error(`Unsupported label payload version: ${payload.v}`)
  return payload.name
}
