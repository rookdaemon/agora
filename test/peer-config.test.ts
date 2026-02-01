import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadPeerConfig,
  savePeerConfig,
  initPeerConfig,
  type PeerConfigFile,
} from '../src/transport/peer-config.js';

describe('Peer Configuration', () => {
  const testDir = '/tmp/agora-test';
  const testConfigPath = join(testDir, 'test-config.json');

  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    // Clean up any existing test file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  describe('initPeerConfig', () => {
    it('should create new keypair if file missing', () => {
      assert.strictEqual(existsSync(testConfigPath), false);

      const config = initPeerConfig(testConfigPath);

      assert.ok(config.identity.publicKey);
      assert.ok(config.identity.privateKey);
      assert.strictEqual(typeof config.identity.publicKey, 'string');
      assert.strictEqual(typeof config.identity.privateKey, 'string');
      assert.deepStrictEqual(config.peers, {});
      assert.strictEqual(existsSync(testConfigPath), true);
    });

    it('should load existing file if present', () => {
      // Create initial config
      const first = initPeerConfig(testConfigPath);
      const firstPublicKey = first.identity.publicKey;

      // Initialize again - should load the same config
      const second = initPeerConfig(testConfigPath);

      assert.strictEqual(second.identity.publicKey, firstPublicKey);
      assert.strictEqual(second.identity.privateKey, first.identity.privateKey);
    });

    it('should generate unique keypairs for different files', () => {
      const path1 = join(testDir, 'config1.json');
      const path2 = join(testDir, 'config2.json');

      try {
        const config1 = initPeerConfig(path1);
        const config2 = initPeerConfig(path2);

        assert.notStrictEqual(config1.identity.publicKey, config2.identity.publicKey);
        assert.notStrictEqual(config1.identity.privateKey, config2.identity.privateKey);
      } finally {
        if (existsSync(path1)) unlinkSync(path1);
        if (existsSync(path2)) unlinkSync(path2);
      }
    });
  });

  describe('savePeerConfig and loadPeerConfig', () => {
    it('should round-trip config correctly', () => {
      const config: PeerConfigFile = {
        identity: {
          publicKey: 'abc123',
          privateKey: 'def456',
        },
        peers: {
          'peer1': {
            url: 'http://localhost:18790/hooks',
            token: 'token123',
            publicKey: 'peer1key',
            name: 'Peer One',
          },
          'peer2': {
            url: 'http://localhost:18791/hooks',
            token: 'token456',
            publicKey: 'peer2key',
          },
        },
      };

      savePeerConfig(testConfigPath, config);
      const loaded = loadPeerConfig(testConfigPath);

      assert.deepStrictEqual(loaded, config);
      assert.strictEqual(loaded.identity.publicKey, 'abc123');
      assert.strictEqual(loaded.identity.privateKey, 'def456');
      assert.strictEqual(loaded.peers['peer1'].url, 'http://localhost:18790/hooks');
      assert.strictEqual(loaded.peers['peer1'].name, 'Peer One');
      assert.strictEqual(loaded.peers['peer2'].url, 'http://localhost:18791/hooks');
      assert.strictEqual(loaded.peers['peer2'].name, undefined);
    });

    it('should handle empty peers object', () => {
      const config: PeerConfigFile = {
        identity: {
          publicKey: 'pub',
          privateKey: 'priv',
        },
        peers: {},
      };

      savePeerConfig(testConfigPath, config);
      const loaded = loadPeerConfig(testConfigPath);

      assert.deepStrictEqual(loaded.peers, {});
    });

    it('should throw error when loading non-existent file', () => {
      const nonExistentPath = join(testDir, 'does-not-exist.json');

      assert.throws(
        () => loadPeerConfig(nonExistentPath),
        /ENOENT/
      );
    });

    it('should throw error when loading invalid JSON', async () => {
      const invalidPath = join(testDir, 'invalid.json');
      const fs = await import('node:fs');
      fs.writeFileSync(invalidPath, 'not valid json', 'utf-8');

      try {
        assert.throws(
          () => loadPeerConfig(invalidPath),
          /JSON/
        );
      } finally {
        if (existsSync(invalidPath)) unlinkSync(invalidPath);
      }
    });
  });

  describe('config file format', () => {
    it('should create valid JSON file', async () => {
      initPeerConfig(testConfigPath);

      const fs = await import('node:fs');
      const content = fs.readFileSync(testConfigPath, 'utf-8');
      
      // Should be valid JSON
      const parsed = JSON.parse(content);
      assert.ok(parsed);
      assert.ok(parsed.identity);
      assert.ok(parsed.peers);
    });

    it('should format JSON with indentation', async () => {
      const config: PeerConfigFile = {
        identity: {
          publicKey: 'pub',
          privateKey: 'priv',
        },
        peers: {
          'test': {
            url: 'http://localhost:18790/hooks',
            token: 'token',
            publicKey: 'key',
          },
        },
      };

      savePeerConfig(testConfigPath, config);

      const fs = await import('node:fs');
      const content = fs.readFileSync(testConfigPath, 'utf-8');
      
      // Check that it's formatted with newlines (not minified)
      assert.ok(content.includes('\n'));
      assert.ok(content.includes('  '));  // Has indentation
    });

    it('should preserve all peer properties', () => {
      const config: PeerConfigFile = {
        identity: {
          publicKey: 'mypub',
          privateKey: 'mypriv',
        },
        peers: {
          'alice': {
            url: 'http://alice.local:18789/hooks',
            token: 'alice-secret',
            publicKey: 'alice-pub-key',
            name: 'Alice Agent',
          },
        },
      };

      savePeerConfig(testConfigPath, config);
      const loaded = loadPeerConfig(testConfigPath);

      assert.strictEqual(loaded.peers['alice'].url, 'http://alice.local:18789/hooks');
      assert.strictEqual(loaded.peers['alice'].token, 'alice-secret');
      assert.strictEqual(loaded.peers['alice'].publicKey, 'alice-pub-key');
      assert.strictEqual(loaded.peers['alice'].name, 'Alice Agent');
    });
  });

  describe('integration: create, modify, reload', () => {
    it('should support adding peers to initialized config', () => {
      // Initialize
      const config = initPeerConfig(testConfigPath);
      const originalPublicKey = config.identity.publicKey;

      // Add a peer
      config.peers['bob'] = {
        url: 'http://bob.local:18790/hooks',
        token: 'bob-token',
        publicKey: 'bob-pub-key',
        name: 'Bob',
      };

      // Save
      savePeerConfig(testConfigPath, config);

      // Reload
      const reloaded = loadPeerConfig(testConfigPath);

      assert.strictEqual(reloaded.identity.publicKey, originalPublicKey);
      assert.ok(reloaded.peers['bob']);
      assert.strictEqual(reloaded.peers['bob'].name, 'Bob');
    });
  });
});
