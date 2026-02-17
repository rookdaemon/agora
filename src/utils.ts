/**
 * Get a short display version of a public key using the last 8 characters.
 * Ed25519 public keys all share the same OID prefix, so the last 8 characters
 * are more distinguishable than the first 8.
 *
 * @param publicKey - The full public key hex string
 * @returns "..." followed by the last 8 characters of the key
 */
export function shortKey(publicKey: string): string {
  return "..." + publicKey.slice(-8);
}

/**
 * Resolves the name to broadcast when connecting to a relay.
 * Priority order:
 * 1. CLI --name flag
 * 2. config.relay.name (if relay is an object with name property)
 * 3. config.identity.name
 * 4. undefined (no name broadcast)
 *
 * @param config - The Agora configuration (or compatible config with identity and optional relay)
 * @param cliName - Optional name from CLI --name flag
 * @returns The resolved name to broadcast, or undefined if none available
 */
export function resolveBroadcastName(
  config: { identity: { name?: string }; relay?: { name?: string } | string },
  cliName?: string
): string | undefined {
  // Priority 1: CLI --name flag
  if (cliName) {
    return cliName;
  }

  // Priority 2: config.relay.name (if relay is an object with name property)
  if (config.relay) {
    if (typeof config.relay === 'object' && config.relay.name) {
      return config.relay.name;
    }
  }

  // Priority 3: config.identity.name
  if (config.identity.name) {
    return config.identity.name;
  }

  // Priority 4: No name available
  return undefined;
}

/**
 * Formats a display name with short ID postfix.
 * If name exists: "name (...3f8c2247)"
 * If no name: "...3f8c2247" (short ID only)
 *
 * @param name - Optional name to display (should not be a short ID)
 * @param publicKey - The public key to use for short ID
 * @returns Formatted display string
 */
export function formatDisplayName(name: string | undefined, publicKey: string): string {
  const shortId = shortKey(publicKey);
  // If name is undefined, empty, or is already a short ID, return only short ID
  if (!name || name.trim() === '' || name.startsWith('...')) {
    return shortId;
  }
  return `${name} (${shortId})`;
}
