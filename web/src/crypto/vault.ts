import type { KdfParams, VaultInfo } from '../types'
import { base64ToBytes, bytesToBase64 } from './aead'
import { DEFAULT_KDF_PARAMS, deriveWrappingKey, generateKdfSalt } from './kdf'
import {
  AAD_RECOVERY,
  AAD_VAULT,
  generateRecoveryKey,
  generateVaultKey,
  unwrapKey,
  wrapKey,
} from './keys'

export interface InitializedVault {
  vaultKey: Uint8Array
  recoveryKey: Uint8Array
  recoveryKeyBase64: string
  kdfSalt: string
  kdfParams: KdfParams
  wrappedVaultKey: string
  wrappedVaultKeyRecovery: string
}

export async function initializeVault(password: string): Promise<InitializedVault> {
  const vaultKey = generateVaultKey()
  const recoveryKey = generateRecoveryKey()
  const salt = generateKdfSalt()
  const kdfParams = DEFAULT_KDF_PARAMS
  const wrappingKey = await deriveWrappingKey(password, salt, kdfParams)
  const wrappedVaultKey = bytesToBase64(await wrapKey(wrappingKey, vaultKey, AAD_VAULT))
  const wrappedVaultKeyRecovery = bytesToBase64(
    await wrapKey(recoveryKey, vaultKey, AAD_RECOVERY),
  )
  return {
    vaultKey,
    recoveryKey,
    recoveryKeyBase64: bytesToBase64(recoveryKey),
    kdfSalt: bytesToBase64(salt),
    kdfParams,
    wrappedVaultKey,
    wrappedVaultKeyRecovery,
  }
}

export async function unlockVaultWithPassword(
  password: string,
  vault: VaultInfo,
): Promise<Uint8Array> {
  if (!vault.kdfSalt || !vault.kdfParams || !vault.wrappedVaultKey) {
    throw new Error('Vault wrap is unavailable')
  }
  const wrappingKey = await deriveWrappingKey(
    password,
    base64ToBytes(vault.kdfSalt),
    vault.kdfParams,
  )
  return unwrapKey(wrappingKey, base64ToBytes(vault.wrappedVaultKey), AAD_VAULT)
}

export async function unlockVaultWithRecovery(
  recoveryKeyBase64: string,
  vault: VaultInfo,
): Promise<Uint8Array> {
  if (!vault.wrappedVaultKeyRecovery) {
    throw new Error('Recovery wrap is unavailable')
  }
  return unwrapKey(
    base64ToBytes(recoveryKeyBase64),
    base64ToBytes(vault.wrappedVaultKeyRecovery),
    AAD_RECOVERY,
  )
}

export async function rewrapVaultForPassword(
  vaultKey: Uint8Array,
  password: string,
  vault: VaultInfo,
): Promise<string> {
  if (!vault.kdfSalt || !vault.kdfParams) {
    throw new Error('Vault KDF parameters are unavailable')
  }
  const wrappingKey = await deriveWrappingKey(
    password,
    base64ToBytes(vault.kdfSalt),
    vault.kdfParams,
  )
  return bytesToBase64(await wrapKey(wrappingKey, vaultKey, AAD_VAULT))
}
