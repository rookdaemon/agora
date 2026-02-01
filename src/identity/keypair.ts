import { sign, verify, generateKeyPairSync } from 'node:crypto';

/**
 * Represents an ed25519 key pair for agent identity
 */
export interface KeyPair {
  publicKey: string;  // hex-encoded
  privateKey: string; // hex-encoded
}

/**
 * Generates a new ed25519 key pair
 * @returns KeyPair with hex-encoded public and private keys
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
  };
}

/**
 * Signs a message with the private key
 * @param message - The message to sign (string or Buffer)
 * @param privateKeyHex - The private key in hex format
 * @returns Signature as hex string
 */
export function signMessage(message: string | Buffer, privateKeyHex: string): string {
  const messageBuffer = typeof message === 'string' ? Buffer.from(message) : message;
  const privateKey = Buffer.from(privateKeyHex, 'hex');
  
  const signature = sign(null, messageBuffer, {
    key: privateKey,
    format: 'der',
    type: 'pkcs8',
  });
  
  return signature.toString('hex');
}

/**
 * Verifies a signature with the public key
 * @param message - The original message (string or Buffer)
 * @param signatureHex - The signature in hex format
 * @param publicKeyHex - The public key in hex format
 * @returns true if signature is valid, false otherwise
 */
export function verifySignature(
  message: string | Buffer,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  const messageBuffer = typeof message === 'string' ? Buffer.from(message) : message;
  const signature = Buffer.from(signatureHex, 'hex');
  const publicKey = Buffer.from(publicKeyHex, 'hex');
  
  try {
    return verify(null, messageBuffer, {
      key: publicKey,
      format: 'der',
      type: 'spki',
    }, signature);
  } catch {
    return false;
  }
}

/**
 * Exports a key pair to a JSON-serializable format
 * @param keyPair - The key pair to export
 * @returns KeyPair object with hex-encoded keys
 */
export function exportKeyPair(keyPair: KeyPair): KeyPair {
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Imports a key pair from hex strings
 * @param publicKeyHex - The public key in hex format
 * @param privateKeyHex - The private key in hex format
 * @returns KeyPair object
 */
export function importKeyPair(publicKeyHex: string, privateKeyHex: string): KeyPair {
  return {
    publicKey: publicKeyHex,
    privateKey: privateKeyHex,
  };
}
