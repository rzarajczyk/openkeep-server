import { argon2id } from 'hash-wasm'
import type { KdfParams } from '../types'
import { randomBytes } from './aead'

export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: 'argon2id',
  m: 65536,
  t: 3,
  p: 1,
}

export function generateKdfSalt(): Uint8Array {
  return randomBytes(16)
}

export async function deriveWrappingKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  if (params.alg !== 'argon2id') throw new Error(`Unsupported KDF: ${params.alg}`)
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: 'binary',
  })
  return new Uint8Array(hash)
}
