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
  
  // Create the canonical signing string: type + from + timestamp + JSON.stringify(payload)
  const signingString = message.type + publicKey + timestamp + JSON.stringify(message.payload);
  
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
    
    // Extract the message payload based on the envelope structure
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, from, timestamp, signature, type, ...rest } = envelope as BaseMessage & Record<string, unknown>;
    const payload = rest.payload;
    
    // Recreate the canonical signing string
    const signingString = type + keyToVerify + timestamp + JSON.stringify(payload);
    
    // Verify the signature
    return verifySignature(signingString, signature, keyToVerify);
  } catch {
    return false;
  }
}
