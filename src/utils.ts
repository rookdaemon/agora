/**
 * Get a short display version of a public key using the last 8 characters.
 * Ed25519 public keys all share the same OID prefix, so the last 8 characters
 * are more distinguishable than the first 8.
 *
 * @param publicKey - The full public key hex string
 * @returns The last 8 characters of the key followed by "..."
 */
export function shortKey(publicKey: string): string {
  return publicKey.slice(-8) + "...";
}
