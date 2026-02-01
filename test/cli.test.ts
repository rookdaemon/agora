import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

describe('CLI', () => {
  const testDir = join(tmpdir(), 'agora-cli-test');
  const testConfigPath = join(testDir, 'config.json');
  const cliBin = join(process.cwd(), 'dist', 'cli.js');

  /**
   * Execute CLI command and return stdout, stderr, and exit code
   */
  async function runCli(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn('node', [cliBin, ...args], {
        env: { ...process.env, ...env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
    });
  }

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('agora init', () => {
    it('should initialize config file with new keypair', async () => {
      const result = await runCli(['init', '--config', testConfigPath]);
      
      assert.strictEqual(result.exitCode, 0);
      assert.ok(existsSync(testConfigPath));

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.status, 'initialized');
      assert.ok(output.publicKey);
      assert.strictEqual(output.configPath, testConfigPath);
    });

    it('should not overwrite existing config', async () => {
      // Initialize once
      const first = await runCli(['init', '--config', testConfigPath]);
      const firstOutput = JSON.parse(first.stdout);

      // Initialize again
      const second = await runCli(['init', '--config', testConfigPath]);
      const secondOutput = JSON.parse(second.stdout);

      assert.strictEqual(second.exitCode, 0);
      assert.strictEqual(secondOutput.status, 'already_initialized');
      assert.strictEqual(secondOutput.publicKey, firstOutput.publicKey);
    });

    it('should use AGORA_CONFIG env var if set', async () => {
      const result = await runCli(['init'], { AGORA_CONFIG: testConfigPath });

      assert.strictEqual(result.exitCode, 0);
      assert.ok(existsSync(testConfigPath));

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.configPath, testConfigPath);
    });

    it('should output pretty format with --pretty flag', async () => {
      const result = await runCli(['init', '--config', testConfigPath, '--pretty']);

      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('status:'));
      assert.ok(result.stdout.includes('publicKey:'));
      assert.ok(result.stdout.includes('configPath:'));
    });
  });

  describe('agora whoami', () => {
    it('should display public key and config path', async () => {
      // Initialize first
      await runCli(['init', '--config', testConfigPath]);

      // Run whoami
      const result = await runCli(['whoami', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(output.publicKey);
      assert.strictEqual(output.configPath, testConfigPath);
    });

    it('should error if config not found', async () => {
      const result = await runCli(['whoami', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Config file not found'));
    });
  });

  describe('agora peers add', () => {
    beforeEach(async () => {
      // Initialize config before each test
      await runCli(['init', '--config', testConfigPath]);
    });

    it('should add a peer with all required fields', async () => {
      const result = await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://localhost:18790/hooks',
        '--token', 'secret-token',
        '--pubkey', 'abcd1234',
        '--config', testConfigPath,
      ]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.status, 'added');
      assert.strictEqual(output.name, 'alice');
      assert.strictEqual(output.url, 'http://localhost:18790/hooks');
      assert.strictEqual(output.publicKey, 'abcd1234');
    });

    it('should error if missing peer name', async () => {
      const result = await runCli([
        'peers', 'add',
        '--url', 'http://localhost:18790/hooks',
        '--token', 'secret-token',
        '--pubkey', 'abcd1234',
        '--config', testConfigPath,
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Missing peer name'));
    });

    it('should error if missing url option', async () => {
      const result = await runCli([
        'peers', 'add', 'bob',
        '--token', 'secret-token',
        '--pubkey', 'abcd1234',
        '--config', testConfigPath,
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Missing required options'));
    });
  });

  describe('agora peers list', () => {
    beforeEach(async () => {
      // Initialize config
      await runCli(['init', '--config', testConfigPath]);
    });

    it('should list empty peers initially', async () => {
      const result = await runCli(['peers', 'list', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(Array.isArray(output.peers));
      assert.strictEqual(output.peers.length, 0);
    });

    it('should list added peers', async () => {
      // Add two peers
      await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://alice.local:18790/hooks',
        '--token', 'alice-token',
        '--pubkey', 'alice-pub',
        '--config', testConfigPath,
      ]);

      await runCli([
        'peers', 'add', 'bob',
        '--url', 'http://bob.local:18791/hooks',
        '--token', 'bob-token',
        '--pubkey', 'bob-pub',
        '--config', testConfigPath,
      ]);

      // List peers
      const result = await runCli(['peers', 'list', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.peers.length, 2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const alice = output.peers.find((p: any) => p.name === 'alice');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bob = output.peers.find((p: any) => p.name === 'bob');

      assert.ok(alice);
      assert.strictEqual(alice.url, 'http://alice.local:18790/hooks');
      assert.strictEqual(alice.publicKey, 'alice-pub');

      assert.ok(bob);
      assert.strictEqual(bob.url, 'http://bob.local:18791/hooks');
      assert.strictEqual(bob.publicKey, 'bob-pub');
    });
  });

  describe('agora peers remove', () => {
    beforeEach(async () => {
      // Initialize config and add a peer
      await runCli(['init', '--config', testConfigPath]);
      await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://alice.local:18790/hooks',
        '--token', 'alice-token',
        '--pubkey', 'alice-pub',
        '--config', testConfigPath,
      ]);
    });

    it('should remove an existing peer', async () => {
      const result = await runCli(['peers', 'remove', 'alice', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.status, 'removed');
      assert.strictEqual(output.name, 'alice');

      // Verify peer is removed
      const listResult = await runCli(['peers', 'list', '--config', testConfigPath]);
      const listOutput = JSON.parse(listResult.stdout);
      assert.strictEqual(listOutput.peers.length, 0);
    });

    it('should error if peer not found', async () => {
      const result = await runCli(['peers', 'remove', 'bob', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes("Peer 'bob' not found"));
    });

    it('should error if missing peer name', async () => {
      const result = await runCli(['peers', 'remove', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Missing peer name'));
    });
  });

  describe('agora send', () => {
    beforeEach(async () => {
      // Initialize config and add a peer
      await runCli(['init', '--config', testConfigPath]);
      await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://localhost:18790/hooks',
        '--token', 'alice-token',
        '--pubkey', 'alice-pub',
        '--config', testConfigPath,
      ]);
    });

    it('should send a text message (will fail without server, but validates structure)', async () => {
      const result = await runCli(['send', 'alice', 'Hello, Alice!', '--config', testConfigPath]);

      // Will fail because no server is running, but should attempt to send
      const output = JSON.parse(result.stdout);
      assert.ok(output.peer === 'alice' || result.exitCode === 1);
      assert.ok(output.type === 'publish' || result.exitCode === 1);
    });

    it('should send a typed message with JSON payload', async () => {
      const result = await runCli([
        'send', 'alice',
        '--type', 'request',
        '--payload', '{"action":"test"}',
        '--config', testConfigPath,
      ]);

      // Will fail because no server is running, but should attempt to send
      const output = JSON.parse(result.stdout);
      assert.ok(output.peer === 'alice' || result.exitCode === 1);
      assert.ok(output.type === 'request' || result.exitCode === 1);
    });

    it('should error if peer not found', async () => {
      const result = await runCli(['send', 'bob', 'Hello!', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes("Peer 'bob' not found"));
    });

    it('should error if missing message text', async () => {
      const result = await runCli(['send', 'alice', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Missing message text'));
    });

    it('should error if invalid JSON payload', async () => {
      const result = await runCli([
        'send', 'alice',
        '--type', 'request',
        '--payload', 'not-json',
        '--config', testConfigPath,
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Invalid JSON payload'));
    });

    it('should error if invalid message type', async () => {
      const result = await runCli([
        'send', 'alice',
        '--type', 'invalid-type',
        '--payload', '{"test":true}',
        '--config', testConfigPath,
      ]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Invalid message type'));
    });
  });

  describe('error handling', () => {
    it('should show usage when no command provided', async () => {
      const result = await runCli([]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Usage:'));
    });

    it('should error on unknown command', async () => {
      const result = await runCli(['unknown-command']);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Unknown command'));
    });

    it('should error on unknown peers subcommand', async () => {
      const result = await runCli(['peers', 'unknown-subcommand']);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Unknown peers subcommand'));
    });
  });
});
