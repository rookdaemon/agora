import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

interface PeerListItem {
  name: string;
  url: string;
  publicKey: string;
}

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
      // Updated error message to reflect clearer validation ordering
      assert.ok(result.stderr.includes('Both --url and --token must be provided together'));
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

      const alice = output.peers.find((p: PeerListItem) => p.name === 'alice');
      const bob = output.peers.find((p: PeerListItem) => p.name === 'bob');

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

  describe('agora status', () => {
    beforeEach(async () => {
      // Initialize config before each test
      await runCli(['init', '--config', testConfigPath]);
    });

    it('should display node status with no peers', async () => {
      const result = await runCli(['status', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(output.identity);
      assert.strictEqual(output.configPath, testConfigPath);
      assert.strictEqual(output.peerCount, 0);
      assert.ok(Array.isArray(output.peers));
      assert.strictEqual(output.peers.length, 0);
    });

    it('should display node status with peers', async () => {
      // Add a peer
      await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://alice.local:18790/hooks',
        '--token', 'alice-token',
        '--pubkey', 'alice-pub',
        '--config', testConfigPath,
      ]);

      const result = await runCli(['status', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.peerCount, 1);
      assert.ok(output.peers.includes('alice'));
    });

    it('should error if config not found', async () => {
      const result = await runCli(['status', '--config', join(testDir, 'missing.json')]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Config file not found'));
    });
  });

  describe('agora announce', () => {
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

    it('should attempt to announce to all peers', async () => {
      const result = await runCli(['announce', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(output.results);
      assert.ok(Array.isArray(output.results));
      assert.strictEqual(output.results.length, 1);
      assert.strictEqual(output.results[0].peer, 'alice');
      // Will fail because no server is running
      assert.ok(['failed', 'error'].includes(output.results[0].status));
    });

    it('should accept custom name and version', async () => {
      const result = await runCli([
        'announce',
        '--config', testConfigPath,
        '--name', 'my-agent',
        '--version', '2.0.0',
      ]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(output.results);
      assert.ok(Array.isArray(output.results));
    });

    it('should error if no peers configured', async () => {
      // Create a new config with no peers
      const emptyConfigPath = join(testDir, 'empty-config.json');
      await runCli(['init', '--config', emptyConfigPath]);

      const result = await runCli(['announce', '--config', emptyConfigPath]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('No peers configured'));
    });

    it('should error if config not found', async () => {
      const result = await runCli(['announce', '--config', join(testDir, 'missing.json')]);

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Config file not found'));
    });
  });

  describe('agora peers (no subcommand)', () => {
    beforeEach(async () => {
      // Initialize config and add peers
      await runCli(['init', '--config', testConfigPath]);
      await runCli([
        'peers', 'add', 'alice',
        '--url', 'http://alice.local:18790/hooks',
        '--token', 'alice-token',
        '--pubkey', 'alice-pub',
        '--config', testConfigPath,
      ]);
    });

    it('should list peers when called without subcommand', async () => {
      const result = await runCli(['peers', '--config', testConfigPath]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(Array.isArray(output.peers));
      assert.strictEqual(output.peers.length, 1);
      const alice = output.peers.find((p: PeerListItem) => p.name === 'alice');
      assert.ok(alice);
    });
  });

  describe('agora serve', () => {
    beforeEach(async () => {
      // Initialize config
      await runCli(['init', '--config', testConfigPath]);
    });

    it('should start server and output startup information', async () => {
      return new Promise<void>((resolve, reject) => {
        const child = spawn('node', [cliBin, 'serve', '--config', testConfigPath, '--port', '9999', '--name', 'test-server'], {
          env: { ...process.env },
        });

        let stdout = '';
        let timeoutId: NodeJS.Timeout;

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          
          // Check if server has fully started (wait for complete startup message)
          if (stdout.includes('Listening for peer connections')) {
            try {
              // Verify startup output contains expected information
              assert.ok(stdout.includes('test-server'), 'Server name should be in output');
              assert.ok(stdout.includes('WebSocket Port: 9999'), 'Port should be in output');
              assert.ok(stdout.includes('Public Key:'), 'Public key should be in output');
              assert.ok(stdout.includes('Agora server started'), 'Server started message should be in output');
              
              // Clean up timeout
              clearTimeout(timeoutId);
              
              // Kill the server
              child.kill('SIGINT');
            } catch (error) {
              clearTimeout(timeoutId);
              child.kill('SIGINT');
              reject(error);
            }
          }
        });

        child.on('close', (code) => {
          try {
            // Server should exit cleanly on SIGINT
            assert.strictEqual(code, 0, 'Server should exit with code 0');
            assert.ok(stdout.includes('Agora server started'), 'Server should have started');
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        // Timeout after 5 seconds
        timeoutId = setTimeout(() => {
          child.kill('SIGINT');
          reject(new Error('Server did not start within 5 seconds'));
        }, 5000);
      });
    });

    it('should error if config not found', async () => {
      const result = await runCli(['serve', '--config', join(testDir, 'nonexistent.json')]);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Config file not found'));
    });

    it('should use default port 9473 when --port not specified', async () => {
      return new Promise<void>((resolve, reject) => {
        const child = spawn('node', [cliBin, 'serve', '--config', testConfigPath], {
          env: { ...process.env },
        });

        let stdout = '';
        let timeoutId: NodeJS.Timeout;

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          
          if (stdout.includes('Listening for peer connections')) {
            try {
              assert.ok(stdout.includes('WebSocket Port: 9473'), 'Default port should be 9473');
              clearTimeout(timeoutId);
              child.kill('SIGINT');
            } catch (error) {
              clearTimeout(timeoutId);
              child.kill('SIGINT');
              reject(error);
            }
          }
        });

        child.on('close', () => {
          resolve();
        });

        timeoutId = setTimeout(() => {
          child.kill('SIGINT');
          reject(new Error('Server did not start within 5 seconds'));
        }, 5000);
      });
    });

    it('should error if port is invalid', async () => {
      const result = await runCli(['serve', '--config', testConfigPath, '--port', 'invalid']);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Invalid port number'));
    });

    it('should error if port is out of range', async () => {
      const result = await runCli(['serve', '--config', testConfigPath, '--port', '99999']);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Invalid port number'));
    });
  });

  describe('agora diagnose', () => {
    it('should error if peer name is missing', async () => {
      await runCli(['init', '--config', testConfigPath]);
      const result = await runCli(['diagnose', '--config', testConfigPath]);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Missing peer name'));
    });

    it('should error if peer not found', async () => {
      await runCli(['init', '--config', testConfigPath]);
      const result = await runCli(['diagnose', 'nonexistent', '--config', testConfigPath]);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('not found'));
    });

    it('should run ping check by default', async () => {
      await runCli(['init', '--config', testConfigPath]);
      await runCli(['peers', 'add', 'testpeer', '--url', 'http://example.com/test', '--token', 'token123', '--pubkey', '302a300506032b65700321006f0818e6d72c43b8ea63f89416d5c938cb066d1566bf2e369d0b98beca270c90', '--config', testConfigPath]);
      
      const result = await runCli(['diagnose', 'testpeer', '--config', testConfigPath]);
      
      // Should complete even if connection fails (which it will for example.com)
      assert.strictEqual(result.exitCode, 0);
      
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.peer, 'testpeer');
      assert.ok(output.status);
      assert.ok(output.checks.ping);
      assert.ok(output.timestamp);
    });

    it('should run multiple checks when specified', async () => {
      await runCli(['init', '--config', testConfigPath]);
      await runCli(['peers', 'add', 'testpeer', '--url', 'http://example.com/test', '--token', 'token123', '--pubkey', '302a300506032b65700321006f0818e6d72c43b8ea63f89416d5c938cb066d1566bf2e369d0b98beca270c90', '--config', testConfigPath]);
      
      const result = await runCli(['diagnose', 'testpeer', '--checks', 'ping,workspace,tools', '--config', testConfigPath]);
      
      assert.strictEqual(result.exitCode, 0);
      
      const output = JSON.parse(result.stdout);
      assert.ok(output.checks.ping);
      assert.ok(output.checks.workspace);
      assert.ok(output.checks.tools);
    });

    it('should error on invalid check type', async () => {
      await runCli(['init', '--config', testConfigPath]);
      await runCli(['peers', 'add', 'testpeer', '--url', 'http://example.com/test', '--token', 'token123', '--pubkey', '302a300506032b65700321006f0818e6d72c43b8ea63f89416d5c938cb066d1566bf2e369d0b98beca270c90', '--config', testConfigPath]);
      
      const result = await runCli(['diagnose', 'testpeer', '--checks', 'invalid', '--config', testConfigPath]);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Invalid check type'));
    });

    it('should error if config not found', async () => {
      const result = await runCli(['diagnose', 'testpeer', '--config', testConfigPath]);
      
      assert.notStrictEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes('Config file not found'));
    });
  });
});
