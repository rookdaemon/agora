import { randomUUID } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { BaseMessage } from './messages.js';

/**
 * Creates a signed message envelope
 * @param message - The message payload with type and payload fields
 * @param privateKey - The sender's private key (hex)
 * @param publicKey - The sender's public key (hex)
 * @returns A complete message with id, timestamp, from, and signature
 */
export function createEnvelope<T extends { type: string; payload: unknown }>(
  message: T,
  privateKey: string,
  publicKey: string
): T & BaseMessage {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  
  // Create the canonical signing string with null byte delimiters to prevent ambiguity attacks
  // Format: type\0from\0timestamp\0payload_json
  const signingString = message.type + '\0' + publicKey + '\0' + timestamp + '\0' + JSON.stringify(message.payload);
  
  // Sign the canonical string
  const signature = signMessage(signingString, privateKey);
  
  return {
    ...message,
    id,
    from: publicKey,
    timestamp,
    signature,
  };
}

/**
 * Verifies the signature of a message envelope
 * @param envelope - The message envelope to verify
 * @param publicKey - The expected sender's public key (hex) - optional, defaults to envelope.from
 * @returns true if signature is valid, false otherwise
 */
export function verifyEnvelope(
  envelope: BaseMessage,
  publicKey?: string
): boolean {
  try {
    const keyToVerify = publicKey || envelope.from;
    
    // Extract the message payload directly with type assertion
    const payload = (envelope as BaseMessage & { payload: unknown }).payload;
    
    // Recreate the canonical signing string with null byte delimiters
    // The signing string must use envelope.from (what was originally signed), not keyToVerify
    // Format: type\0from\0timestamp\0payload_json
    const signingString = envelope.type + '\0' + envelope.from + '\0' + envelope.timestamp + '\0' + JSON.stringify(payload);
    
    // Verify the signature using the provided key (or envelope.from if not provided)
    return verifySignature(signingString, envelope.signature, keyToVerify);
  } catch {
    return false;
  }
}
