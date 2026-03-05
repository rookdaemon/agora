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

interface PeerReferenceEntry {
  publicKey: string;
  name?: string;
}

type PeerReferenceDirectory =
  | Record<string, PeerReferenceEntry>
  | Map<string, PeerReferenceEntry>
  | PeerReferenceEntry[];

function toDirectoryEntries(directory?: PeerReferenceDirectory): PeerReferenceEntry[] {
  if (!directory) {
    return [];
  }
  if (Array.isArray(directory)) {
    return directory.filter((p) => typeof p.publicKey === 'string' && p.publicKey.length > 0);
  }
  if (directory instanceof Map) {
    return Array.from(directory.values()).filter((p) => typeof p.publicKey === 'string' && p.publicKey.length > 0);
  }
  return Object.values(directory).filter((p) => typeof p.publicKey === 'string' && p.publicKey.length > 0);
}

function findById(id: string, directory?: PeerReferenceDirectory): PeerReferenceEntry | undefined {
  return toDirectoryEntries(directory).find((entry) => entry.publicKey === id);
}

function countByName(directory?: PeerReferenceDirectory): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of toDirectoryEntries(directory)) {
    if (!entry.name) continue;
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Shorten a full peer ID for display/reference.
 * Priority:
 * - Unique configured name => "name"
 * - Duplicate configured name => "name...<last8>"
 * - Unknown/no-name => "...<last8>"
 */
export function shorten(id: string, directory?: PeerReferenceDirectory): string {
  const suffix = id.slice(-8);
  const entry = findById(id, directory);
  if (!entry?.name) {
    return `...${suffix}`;
  }
  const duplicateCount = countByName(directory).get(entry.name) ?? 0;
  if (duplicateCount > 1) {
    return `${entry.name}...${suffix}`;
  }
  return entry.name;
}

/**
 * Expand a short peer reference to a full ID.
 * Supports: full ID, unique name, ...last8, and name...last8.
 */
export function expand(shortId: string, directory: PeerReferenceDirectory): string | undefined {
  const entries = toDirectoryEntries(directory);
  if (entries.length === 0) {
    return undefined;
  }

  const token = shortId.trim();
  const direct = entries.find((entry) => entry.publicKey === token);
  if (direct) {
    return direct.publicKey;
  }

  const namedWithSuffix = token.match(/^(.+)\.\.\.([0-9a-fA-F]{8})$/);
  if (namedWithSuffix) {
    const [, name, suffix] = namedWithSuffix;
    const matches = entries.filter((entry) => entry.name === name && entry.publicKey.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length === 1) {
      return matches[0].publicKey;
    }
    return undefined;
  }

  const suffixOnly = token.match(/^\.\.\.([0-9a-fA-F]{8})$/);
  if (suffixOnly) {
    const [, suffix] = suffixOnly;
    const matches = entries.filter((entry) => entry.publicKey.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length === 1) {
      return matches[0].publicKey;
    }
    return undefined;
  }

  const byName = entries.filter((entry) => entry.name === token);
  if (byName.length === 1) {
    return byName[0].publicKey;
  }

  return undefined;
}

/**
 * Expand inline @references in text to full IDs using configured peers.
 */
export function expandInlineReferences(text: string, directory: PeerReferenceDirectory): string {
  return text.replace(/@([^\s]+)/g, (_full, token: string) => {
    const resolved = expand(token, directory);
    return resolved ? `@${resolved}` : `@${token}`;
  });
}

/**
 * Compact inline @<full-id> references for rendering.
 */
export function compactInlineReferences(text: string, directory: PeerReferenceDirectory): string {
  return text.replace(/@([0-9a-fA-F]{16,})/g, (_full, id: string) => `@${shorten(id, directory)}`);
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
