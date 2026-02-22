import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDefaultBootstrapRelay, parseBootstrapRelay, DEFAULT_BOOTSTRAP_RELAYS } from '../../src/discovery/bootstrap';

describe('Bootstrap', () => {
  describe('DEFAULT_BOOTSTRAP_RELAYS', () => {
    it('should have at least one bootstrap relay', () => {
      assert.ok(DEFAULT_BOOTSTRAP_RELAYS.length > 0, 'Should have at least one bootstrap relay');
    });

    it('should have valid relay URLs', () => {
      for (const relay of DEFAULT_BOOTSTRAP_RELAYS) {
        assert.ok(relay.url, 'Relay should have a URL');
        assert.ok(relay.url.startsWith('ws://') || relay.url.startsWith('wss://'), 'URL should be WebSocket');
        assert.ok(relay.name, 'Relay should have a name');
      }
    });
  });

  describe('getDefaultBootstrapRelay', () => {
    it('should return default bootstrap relay config', () => {
      const config = getDefaultBootstrapRelay();
      
      assert.ok(config, 'Should return config');
      assert.ok(config.relayUrl, 'Should have relay URL');
      assert.strictEqual(config.relayUrl, DEFAULT_BOOTSTRAP_RELAYS[0].url, 'Should use first bootstrap relay');
      assert.strictEqual(config.timeout, 10000, 'Should have default timeout');
    });
  });

  describe('parseBootstrapRelay', () => {
    it('should parse relay URL without public key', () => {
      const url = 'wss://test-relay.example.com';
      const config = parseBootstrapRelay(url);
      
      assert.strictEqual(config.relayUrl, url, 'URL should match');
      assert.strictEqual(config.relayPublicKey, undefined, 'Public key should be undefined');
      assert.strictEqual(config.timeout, 10000, 'Should have default timeout');
    });

    it('should parse relay URL with public key', () => {
      const url = 'wss://test-relay.example.com';
      const pubkey = 'abc123';
      const config = parseBootstrapRelay(url, pubkey);
      
      assert.strictEqual(config.relayUrl, url, 'URL should match');
      assert.strictEqual(config.relayPublicKey, pubkey, 'Public key should match');
      assert.strictEqual(config.timeout, 10000, 'Should have default timeout');
    });
  });
});
