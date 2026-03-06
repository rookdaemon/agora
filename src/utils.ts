/**
 * Get a short display version of a public key using the last 8 characters.
 * Ed25519 public keys all share the same OID prefix, so the last 8 characters
 * are more distinguishable than the first 8.
 *
 * @param publicKey - The full public key hex string
 * @returns "..." followed by the last 8 characters of the key
 */
export function shortKey(publicKey: string): string {
  return "@" + publicKey.slice(-8);
}

export interface PeerReferenceEntry {
  publicKey: string;
  name?: string;
}

export type PeerReferenceDirectory =
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

/**
 * Shorten a full peer ID for display/reference.
 * Canonical form:
 * - Configured name => "name@<last8>"
 * - Unknown/no-name => "@<last8>"
 */
export function shorten(id: string, directory?: PeerReferenceDirectory): string {
  const suffix = id.slice(-8);
  const entry = findById(id, directory);
  if (!entry?.name) {
    return `@${suffix}`;
  }
  return `${entry.name}@${suffix}`;
}

/**
 * Expand a short peer reference to a full ID.
 * Supports: full ID, unique name, name@last8, @last8.
 * Also supports legacy name...last8 and ...last8 forms.
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

  // name@suffix8 (current canonical form)
  const namedAtSuffix = token.match(/^(.+)@([0-9a-fA-F]{8})$/);
  if (namedAtSuffix) {
    const [, name, suffix] = namedAtSuffix;
    const matches = entries.filter((entry) => entry.name === name && entry.publicKey.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length === 1) {
      return matches[0].publicKey;
    }
    return undefined;
  }

  // @suffix8 (current canonical form for unknown peers)
  const atSuffixOnly = token.match(/^@([0-9a-fA-F]{8})$/);
  if (atSuffixOnly) {
    const [, suffix] = atSuffixOnly;
    const matches = entries.filter((entry) => entry.publicKey.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length === 1) {
      return matches[0].publicKey;
    }
    return undefined;
  }

  // Legacy: name...suffix8
  const namedWithSuffix = token.match(/^(.+)\.\.\.([0-9a-fA-F]{8})$/);
  if (namedWithSuffix) {
    const [, name, suffix] = namedWithSuffix;
    const matches = entries.filter((entry) => entry.name === name && entry.publicKey.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length === 1) {
      return matches[0].publicKey;
    }
    return undefined;
  }

  // Legacy: ...suffix8
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
 * Compact inline @<full-id> references only when the full ID exists in the
 * provided directory. Unknown IDs remain unchanged.
 */
export function compactKnownInlineReferences(text: string, directory: PeerReferenceDirectory): string {
  return text.replace(/@([0-9a-fA-F]{16,})/g, (_full, id: string) => {
    const known = findById(id, directory);
    if (!known) {
      return `@${id}`;
    }
    return `@${shorten(id, directory)}`;
  });
}

/**
 * Extract text content from an envelope payload.
 * Handles { text: string } objects, plain strings, and fallback to JSON.
 * All output is sanitized.
 */
export function extractTextFromPayload(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'text' in payload && typeof (payload as { text: unknown }).text === 'string') {
    return sanitizeText((payload as { text: string }).text);
  }
  if (typeof payload === 'string') return sanitizeText(payload);
  return sanitizeText(JSON.stringify(payload ?? ''));
}

/**
 * Strip characters that can crash downstream width/segmenter logic in UIs.
 * Removes control chars (except newline/tab) and replaces lone surrogates.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/**
 * Resolve a display name for a peer.
 * Only returns locally configured names from the peer directory.
 * Sender-claimed names are never used — identity must be derived from verified keys.
 */
export function resolveDisplayName(
  publicKey: string,
  _peerName?: string | undefined,
  directory?: PeerReferenceDirectory,
): string | undefined {
  const entry = findById(publicKey, directory);
  if (entry?.name) {
    return entry.name;
  }

  return undefined;
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
 * Formats a display name using the canonical moniker form.
 * If name exists: "name@3f8c2247"  (same form as shorten())
 * If no name: "@3f8c2247" (short ID only)
 *
 * @param name - Optional name to display (should not be a short ID)
 * @param publicKey - The public key to use for short ID
 * @returns Formatted display string
 */
export function formatDisplayName(name: string | undefined, publicKey: string): string {
  const suffix = publicKey.slice(-8);
  // If name is undefined, empty, or is already a short ID, return only short ID
  if (!name || name.trim() === '' || name.startsWith('...') || name.startsWith('@')) {
    return `@${suffix}`;
  }
  return `${name}@${suffix}`;
}

/**
 * A conversation entry with FROM/TO metadata, used for CONVERSATION.md formatting.
 */
export interface ConversationEntry {
  timestamp: number;
  from: string;
  to: string[];
  text: string;
}

/**
 * Format a conversation entry as a single line for CONVERSATION.md.
 * Format: [ISO_TIMESTAMP] **FROM:** sender **TO:** recipient1, recipient2 text
 */
export function formatConversationLine(entry: ConversationEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const toList = entry.to.length > 0 ? entry.to.join(', ') : '(none)';
  const safeText = entry.text.replace(/\r?\n/g, ' ');
  return `[${ts}] **FROM:** ${entry.from} **TO:** ${toList} ${safeText}`;
}

/**
 * Parse a single CONVERSATION.md line back into a ConversationEntry.
 * Returns null if the line doesn't match the expected format.
 */
export function parseConversationLine(line: string): ConversationEntry | null {
  const match = line.match(
    /^\[([^\]]+)\] \*\*FROM:\*\* (\S+) \*\*TO:\*\* ([^\s,]+(?:, [^\s,]+)*|\(none\))(?: (.*))?$/
  );
  if (!match) return null;
  const [, ts, from, toRaw, text] = match;
  const timestamp = new Date(ts).getTime();
  if (isNaN(timestamp)) return null;
  const to = toRaw === '(none)' ? [] : toRaw.split(', ').filter(Boolean);
  return { timestamp, from, to, text: text ?? '' };
}
