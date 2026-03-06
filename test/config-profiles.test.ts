import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getProfileConfigPath,
  getConfigDir,
  listProfiles,
  exportConfig,
  importConfig,
  loadAgoraConfig,
  saveAgoraConfig,
  type AgoraConfig,
  type ExportedConfig,
} from '../src/config';

describe('Profile support', () => {
  const testBase = join(tmpdir(), 'agora-profile-test');

  beforeEach(() => {
    // Set env to isolate from real config
    process.env.AGORA_CONFIG_DIR = testBase;
    delete process.env.AGORA_CONFIG;
    if (existsSync(testBase)) {
      rmSync(testBase, { recursive: true });
    }
    mkdirSync(testBase, { recursive: true });
  });

  afterEach(() => {
    delete process.env.AGORA_CONFIG_DIR;
    delete process.env.AGORA_CONFIG;
    if (existsSync(testBase)) {
      rmSync(testBase, { recursive: true });
    }
  });

  describe('getProfileConfigPath', () => {
    it('should return default config path when no profile', () => {
      const p = getProfileConfigPath();
      assert.strictEqual(p, join(testBase, 'config.json'));
    });

    it('should return default config path for "default" profile', () => {
      const p = getProfileConfigPath('default');
      assert.strictEqual(p, join(testBase, 'config.json'));
    });

    it('should return named profile path', () => {
      const p = getProfileConfigPath('stefan');
      assert.strictEqual(p, join(testBase, 'profiles', 'stefan', 'config.json'));
    });

    it('should respect AGORA_CONFIG env override', () => {
      process.env.AGORA_CONFIG = '/custom/path.json';
      const p = getProfileConfigPath('stefan');
      assert.ok(p.endsWith('path.json'));
      delete process.env.AGORA_CONFIG;
    });
  });

  describe('listProfiles', () => {
    it('should return empty when no configs exist', () => {
      assert.deepStrictEqual(listProfiles(), []);
    });

    it('should list default profile', () => {
      writeFileSync(join(testBase, 'config.json'), '{}');
      assert.deepStrictEqual(listProfiles(), ['default']);
    });

    it('should list named profiles', () => {
      const stefanDir = join(testBase, 'profiles', 'stefan');
      mkdirSync(stefanDir, { recursive: true });
      writeFileSync(join(stefanDir, 'config.json'), '{}');
      assert.deepStrictEqual(listProfiles(), ['stefan']);
    });

    it('should list both default and named profiles', () => {
      writeFileSync(join(testBase, 'config.json'), '{}');
      const stefanDir = join(testBase, 'profiles', 'stefan');
      mkdirSync(stefanDir, { recursive: true });
      writeFileSync(join(stefanDir, 'config.json'), '{}');
      const profiles = listProfiles();
      assert.ok(profiles.includes('default'));
      assert.ok(profiles.includes('stefan'));
    });

    it('should skip directories without config.json', () => {
      const emptyDir = join(testBase, 'profiles', 'ghost');
      mkdirSync(emptyDir, { recursive: true });
      assert.deepStrictEqual(listProfiles(), []);
    });
  });
});

describe('Export / Import', () => {
  const sampleConfig: AgoraConfig = {
    identity: { publicKey: 'pub1', privateKey: 'priv1', name: 'alice' },
    peers: {
      pub_bob: { publicKey: 'pub_bob', name: 'bob', url: 'http://bob:3000', token: 'tok' },
      pub_charlie: { publicKey: 'pub_charlie', name: 'charlie' },
    },
    relay: { url: 'wss://relay.example.com', autoConnect: true },
  };

  describe('exportConfig', () => {
    it('should export peers and relay without identity by default', () => {
      const exported = exportConfig(sampleConfig);
      assert.strictEqual(exported.version, 1);
      assert.ok(exported.peers.pub_bob);
      assert.ok(exported.peers.pub_charlie);
      assert.ok(exported.relay);
      assert.strictEqual(exported.identity, undefined);
    });

    it('should include identity when requested', () => {
      const exported = exportConfig(sampleConfig, { includeIdentity: true });
      assert.ok(exported.identity);
      assert.strictEqual(exported.identity!.publicKey, 'pub1');
      assert.strictEqual(exported.identity!.privateKey, 'priv1');
    });

    it('should not share references with original', () => {
      const exported = exportConfig(sampleConfig, { includeIdentity: true });
      exported.peers.pub_bob.name = 'changed';
      assert.strictEqual(sampleConfig.peers.pub_bob.name, 'bob');
    });
  });

  describe('importConfig', () => {
    it('should merge new peers into target', () => {
      const target: AgoraConfig = {
        identity: { publicKey: 'local_pub', privateKey: 'local_priv' },
        peers: {
          pub_bob: { publicKey: 'pub_bob', name: 'existing-bob' },
        },
      };

      const incoming: ExportedConfig = {
        version: 1,
        peers: {
          pub_bob: { publicKey: 'pub_bob', name: 'incoming-bob' },
          pub_charlie: { publicKey: 'pub_charlie', name: 'charlie' },
        },
      };

      const result = importConfig(target, incoming);

      // bob was already present — skipped (not overwritten)
      assert.deepStrictEqual(result.peersSkipped, ['pub_bob']);
      assert.strictEqual(target.peers.pub_bob.name, 'existing-bob');

      // charlie was new — added
      assert.deepStrictEqual(result.peersAdded, ['pub_charlie']);
      assert.strictEqual(target.peers.pub_charlie.name, 'charlie');

      assert.strictEqual(result.identityImported, false);
      assert.strictEqual(result.relayImported, false);
    });

    it('should not overwrite identity unless opted in', () => {
      const target: AgoraConfig = {
        identity: { publicKey: 'local', privateKey: 'local_priv' },
        peers: {},
      };

      const incoming: ExportedConfig = {
        version: 1,
        identity: { publicKey: 'remote', privateKey: 'remote_priv' },
        peers: {},
      };

      importConfig(target, incoming);
      assert.strictEqual(target.identity.publicKey, 'local');
    });

    it('should overwrite identity when opted in', () => {
      const target: AgoraConfig = {
        identity: { publicKey: 'local', privateKey: 'local_priv' },
        peers: {},
      };

      const incoming: ExportedConfig = {
        version: 1,
        identity: { publicKey: 'remote', privateKey: 'remote_priv' },
        peers: {},
      };

      const result = importConfig(target, incoming, { overwriteIdentity: true });
      assert.strictEqual(target.identity.publicKey, 'remote');
      assert.strictEqual(result.identityImported, true);
    });

    it('should overwrite relay when opted in', () => {
      const target: AgoraConfig = {
        identity: { publicKey: 'a', privateKey: 'b' },
        peers: {},
        relay: { url: 'wss://old', autoConnect: true },
      };

      const incoming: ExportedConfig = {
        version: 1,
        peers: {},
        relay: { url: 'wss://new', autoConnect: false },
      };

      const result = importConfig(target, incoming, { overwriteRelay: true });
      assert.strictEqual(target.relay!.url, 'wss://new');
      assert.strictEqual(result.relayImported, true);
    });
  });
});

describe('saveAgoraConfig / loadAgoraConfig round-trip', () => {
  const testBase = join(tmpdir(), 'agora-save-test');
  const testPath = join(testBase, 'profiles', 'test', 'config.json');

  afterEach(() => {
    if (existsSync(testBase)) {
      rmSync(testBase, { recursive: true });
    }
  });

  it('should create directories and round-trip config', () => {
    const config: AgoraConfig = {
      identity: { publicKey: 'pk', privateKey: 'sk', name: 'tester' },
      peers: {
        abc: { publicKey: 'abc', name: 'peer-a' },
      },
      relay: { url: 'wss://relay', autoConnect: true },
    };

    saveAgoraConfig(testPath, config);
    assert.ok(existsSync(testPath));

    const loaded = loadAgoraConfig(testPath);
    assert.strictEqual(loaded.identity.publicKey, 'pk');
    assert.strictEqual(loaded.identity.name, 'tester');
    assert.strictEqual(loaded.peers.abc.name, 'peer-a');
    assert.strictEqual(loaded.relay!.url, 'wss://relay');
  });
});
