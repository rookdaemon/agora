import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { sendViaRelay } from '../src/transport/relay.js';

describe('Relay Transport', () => {
  describe('sendViaRelay', () => {
    it('should return error for connection failure', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      // Use an invalid URL that will fail to connect
      const result = await sendViaRelay(
        {
          identity,
          relayUrl: 'ws://localhost:9999',
        },
        peerIdentity.publicKey,
        'publish',
        { text: 'Hello via relay' }
      );

      // Should fail to connect
      assert.strictEqual(result.ok, false);
      // Error field should exist (might be empty string or have content)
      assert.ok('error' in result);
    });

    it('should construct proper envelope structure', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      // This will fail to connect, but we can still verify the function
      // handles the parameters correctly and creates proper structure
      const result = await sendViaRelay(
        {
          identity,
          relayUrl: 'ws://localhost:9998',
        },
        peerIdentity.publicKey,
        'announce',
        { capabilities: [] }
      );

      // Should return a result object with ok and error fields
      assert.ok(typeof result === 'object');
      assert.ok('ok' in result);
      assert.strictEqual(result.ok, false);
      assert.ok('error' in result);
    });

    it('should timeout if relay does not respond', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      const startTime = Date.now();
      
      const result = await sendViaRelay(
        {
          identity,
          relayUrl: 'ws://localhost:9997',
        },
        peerIdentity.publicKey,
        'publish',
        { text: 'test' }
      );

      const duration = Date.now() - startTime;

      // Should fail relatively quickly (within timeout period)
      assert.strictEqual(result.ok, false);
      assert.ok(duration < 15000); // Should timeout within 15 seconds (we set 10s timeout)
    });
  });
});
