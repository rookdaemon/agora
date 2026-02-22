import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateKeyPair,
  signMessage,
  verifySignature,
  exportKeyPair,
  importKeyPair,
} from '../src/identity/keypair';

describe('KeyPair', () => {
  describe('generateKeyPair', () => {
    it('should generate a valid key pair', () => {
      const keyPair = generateKeyPair();
      
      assert.ok(keyPair.publicKey);
      assert.ok(keyPair.privateKey);
      assert.strictEqual(typeof keyPair.publicKey, 'string');
      assert.strictEqual(typeof keyPair.privateKey, 'string');
    });

    it('should generate unique key pairs', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      
      assert.notStrictEqual(keyPair1.publicKey, keyPair2.publicKey);
      assert.notStrictEqual(keyPair1.privateKey, keyPair2.privateKey);
    });

    it('should generate hex-encoded keys', () => {
      const keyPair = generateKeyPair();
      
      // Hex strings should only contain valid hex characters
      assert.match(keyPair.publicKey, /^[0-9a-f]+$/i);
      assert.match(keyPair.privateKey, /^[0-9a-f]+$/i);
    });
  });

  describe('signMessage', () => {
    it('should sign a string message', () => {
      const keyPair = generateKeyPair();
      const message = 'Hello, Agora!';
      
      const signature = signMessage(message, keyPair.privateKey);
      
      assert.ok(signature);
      assert.strictEqual(typeof signature, 'string');
      assert.match(signature, /^[0-9a-f]+$/i);
    });

    it('should sign a Buffer message', () => {
      const keyPair = generateKeyPair();
      const message = Buffer.from('Hello, Agora!');
      
      const signature = signMessage(message, keyPair.privateKey);
      
      assert.ok(signature);
      assert.strictEqual(typeof signature, 'string');
    });

    it('should produce different signatures for different messages', () => {
      const keyPair = generateKeyPair();
      const message1 = 'Message 1';
      const message2 = 'Message 2';
      
      const signature1 = signMessage(message1, keyPair.privateKey);
      const signature2 = signMessage(message2, keyPair.privateKey);
      
      assert.notStrictEqual(signature1, signature2);
    });

    it('should produce different signatures with different keys', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      const message = 'Same message';
      
      const signature1 = signMessage(message, keyPair1.privateKey);
      const signature2 = signMessage(message, keyPair2.privateKey);
      
      assert.notStrictEqual(signature1, signature2);
    });
  });

  describe('verifySignature', () => {
    it('should verify a valid signature', () => {
      const keyPair = generateKeyPair();
      const message = 'Hello, Agora!';
      const signature = signMessage(message, keyPair.privateKey);
      
      const isValid = verifySignature(message, signature, keyPair.publicKey);
      
      assert.strictEqual(isValid, true);
    });

    it('should verify a Buffer message signature', () => {
      const keyPair = generateKeyPair();
      const message = Buffer.from('Hello, Agora!');
      const signature = signMessage(message, keyPair.privateKey);
      
      const isValid = verifySignature(message, signature, keyPair.publicKey);
      
      assert.strictEqual(isValid, true);
    });

    it('should reject an invalid signature', () => {
      const keyPair = generateKeyPair();
      const message = 'Hello, Agora!';
      const signature = signMessage(message, keyPair.privateKey);
      
      // Tamper with the signature
      const tamperedSignature = signature.slice(0, -2) + 'ff';
      const isValid = verifySignature(message, tamperedSignature, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject signature with wrong public key', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      const message = 'Hello, Agora!';
      
      const signature = signMessage(message, keyPair1.privateKey);
      const isValid = verifySignature(message, signature, keyPair2.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject signature for different message', () => {
      const keyPair = generateKeyPair();
      const message1 = 'Original message';
      const message2 = 'Different message';
      
      const signature = signMessage(message1, keyPair.privateKey);
      const isValid = verifySignature(message2, signature, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should handle invalid signature format gracefully', () => {
      const keyPair = generateKeyPair();
      const message = 'Hello, Agora!';
      const invalidSignature = 'not-a-valid-signature';
      
      const isValid = verifySignature(message, invalidSignature, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });
  });

  describe('exportKeyPair', () => {
    it('should export a key pair', () => {
      const keyPair = generateKeyPair();
      const exported = exportKeyPair(keyPair);
      
      assert.strictEqual(exported.publicKey, keyPair.publicKey);
      assert.strictEqual(exported.privateKey, keyPair.privateKey);
    });

    it('should return a serializable object', () => {
      const keyPair = generateKeyPair();
      const exported = exportKeyPair(keyPair);
      
      // Should be JSON-serializable
      const json = JSON.stringify(exported);
      const parsed = JSON.parse(json);
      
      assert.strictEqual(parsed.publicKey, keyPair.publicKey);
      assert.strictEqual(parsed.privateKey, keyPair.privateKey);
    });
  });

  describe('importKeyPair', () => {
    it('should import a key pair from hex strings', () => {
      const original = generateKeyPair();
      const imported = importKeyPair(original.publicKey, original.privateKey);
      
      assert.strictEqual(imported.publicKey, original.publicKey);
      assert.strictEqual(imported.privateKey, original.privateKey);
    });

    it('should create a working key pair', () => {
      const original = generateKeyPair();
      const imported = importKeyPair(original.publicKey, original.privateKey);
      
      const message = 'Test message';
      const signature = signMessage(message, imported.privateKey);
      const isValid = verifySignature(message, signature, imported.publicKey);
      
      assert.strictEqual(isValid, true);
    });

    it('should reject invalid public key hex string', () => {
      const original = generateKeyPair();
      const invalidPublicKey = 'not-a-hex-string';
      
      assert.throws(
        () => importKeyPair(invalidPublicKey, original.privateKey),
        /Invalid public key: must be a hex string/
      );
    });

    it('should reject invalid private key hex string', () => {
      const original = generateKeyPair();
      const invalidPrivateKey = 'not-a-hex-string';
      
      assert.throws(
        () => importKeyPair(original.publicKey, invalidPrivateKey),
        /Invalid private key: must be a hex string/
      );
    });
  });

  describe('end-to-end cryptographic flow', () => {
    it('should support complete sign-verify workflow', () => {
      // Generate key pair
      const keyPair = generateKeyPair();
      
      // Sign a message
      const message = 'This is a cryptographically signed message from an Agora agent';
      const signature = signMessage(message, keyPair.privateKey);
      
      // Verify the signature
      const isValid = verifySignature(message, signature, keyPair.publicKey);
      assert.strictEqual(isValid, true);
      
      // Export and re-import
      const exported = exportKeyPair(keyPair);
      const json = JSON.stringify(exported);
      const parsed = JSON.parse(json);
      const imported = importKeyPair(parsed.publicKey, parsed.privateKey);
      
      // Verify the signature still works with imported key
      const stillValid = verifySignature(message, signature, imported.publicKey);
      assert.strictEqual(stillValid, true);
    });
  });
});
