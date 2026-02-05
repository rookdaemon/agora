import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { RelayServer } from '../src/relay/server.js';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';

describe('RelayServer', () => {
  let server: RelayServer;
  const port = 19474; // Use a unique port for testing

  before(async () => {
    server = new RelayServer();
    await server.start(port);
  });

  after(async () => {
    await server.stop();
  });

  test('should accept agent registration', async () => {
    const agent = generateKeyPair();
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', publicKey: agent.publicKey }));
      });

      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered') {
          const agents = server.getAgents();
          assert.strictEqual(agents.has(agent.publicKey), true);
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  });

  test('should reject messages before registration', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        // Try to send message without registering first
        ws.send(JSON.stringify({
          type: 'message',
          to: 'some-public-key',
          envelope: {},
        }));
      });

      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') {
          assert.ok(msg.message.includes('Not registered'));
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
    });
  });

  test('should route messages between two agents', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();
    
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      let agent1Registered = false;
      let agent2Registered = false;

      // Helper to send message once both agents are registered
      const trySendMessage = (): void => {
        if (agent1Registered && agent2Registered) {
          const envelope = createEnvelope(
            'publish',
            agent1.publicKey,
            agent1.privateKey,
            { text: 'Hello from agent 1' }
          );
          
          ws1.send(JSON.stringify({
            type: 'message',
            to: agent2.publicKey,
            envelope,
          }));
        }
      };

      // Register agent 1
      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', publicKey: agent1.publicKey }));
      });

      ws1.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered' && !agent1Registered) {
          agent1Registered = true;
          trySendMessage();
        }
      });

      // Register agent 2
      ws2.on('open', () => {
        ws2.send(JSON.stringify({ type: 'register', publicKey: agent2.publicKey }));
      });

      ws2.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered' && !agent2Registered) {
          agent2Registered = true;
          trySendMessage();
        } else if (msg.id) {
          // Received the relayed envelope
          assert.strictEqual(msg.sender, agent1.publicKey);
          assert.strictEqual(msg.type, 'publish');
          assert.deepStrictEqual(msg.payload, { text: 'Hello from agent 1' });
          
          ws1.close();
          ws2.close();
          resolve();
        }
      });

      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  });

  test('should reject invalid envelope signature', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();
    
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      let agent1Registered = false;
      let agent2Registered = false;

      // Register agent 1
      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', publicKey: agent1.publicKey }));
      });

      ws1.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered' && !agent1Registered) {
          agent1Registered = true;
        } else if (msg.type === 'error') {
          // Should get error about invalid envelope
          assert.ok(msg.message.includes('Invalid envelope'));
          ws1.close();
          ws2.close();
          resolve();
        }
      });

      // Register agent 2
      ws2.on('open', () => {
        ws2.send(JSON.stringify({ type: 'register', publicKey: agent2.publicKey }));
      });

      ws2.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered' && !agent2Registered) {
          agent2Registered = true;
          
          // Wait for both to be registered, then send invalid envelope
          if (agent1Registered) {
            // Create envelope but with wrong signature
            const envelope = createEnvelope(
              'publish',
              agent1.publicKey,
              agent1.privateKey,
              { text: 'Hello' }
            );
            
            // Tamper with the signature
            envelope.signature = 'invalid_signature';
            
            ws1.send(JSON.stringify({
              type: 'message',
              to: agent2.publicKey,
              envelope,
            }));
          }
        }
      });

      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  });

  test('should reject message with wrong sender', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();
    const agent3 = generateKeyPair(); // Not registered
    
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      let agent1Registered = false;
      let agent2Registered = false;

      // Register agent 1
      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', publicKey: agent1.publicKey }));
      });

      ws1.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered' && !agent1Registered) {
          agent1Registered = true;
        } else if (msg.type === 'error') {
          // Should get error about sender mismatch
          assert.ok(msg.message.includes('sender does not match'));
          ws1.close();
          ws2.close();
          resolve();
        }
      });

      // Register agent 2
      ws2.on('open', () => {
        ws2.send(JSON.stringify({ type: 'register', publicKey: agent2.publicKey }));
      });

      ws2.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered' && !agent2Registered) {
          agent2Registered = true;
          
          // Wait for both to be registered
          if (agent1Registered) {
            // Create envelope signed by agent3 but send from agent1
            const envelope = createEnvelope(
              'publish',
              agent3.publicKey,
              agent3.privateKey,
              { text: 'Spoofed message' }
            );
            
            ws1.send(JSON.stringify({
              type: 'message',
              to: agent2.publicKey,
              envelope,
            }));
          }
        }
      });

      ws1.on('error', reject);
      ws2.on('error', reject);
    });
  });

  test('should handle recipient not connected', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair(); // Not connected
    
    const ws1 = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      // Register agent 1
      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', publicKey: agent1.publicKey }));
      });

      ws1.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'registered') {
          // Try to send message to non-connected agent
          const envelope = createEnvelope(
            'publish',
            agent1.publicKey,
            agent1.privateKey,
            { text: 'Hello' }
          );
          
          ws1.send(JSON.stringify({
            type: 'message',
            to: agent2.publicKey,
            envelope,
          }));
        } else if (msg.type === 'error') {
          // Should get error about recipient not connected
          assert.ok(msg.message.includes('Recipient not connected'));
          ws1.close();
          resolve();
        }
      });

      ws1.on('error', reject);
    });
  });

  test('should remove agent on disconnect', async () => {
    const agent = generateKeyPair();
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', publicKey: agent.publicKey }));
      });

      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered') {
          // Verify agent is registered
          const agents = server.getAgents();
          assert.strictEqual(agents.has(agent.publicKey), true);
          
          // Close connection
          ws.close();
        }
      });

      ws.on('close', () => {
        // Give the server time to process the disconnection
        setTimeout(() => {
          const agents = server.getAgents();
          assert.strictEqual(agents.has(agent.publicKey), false);
          resolve();
        }, 100);
      });

      ws.on('error', reject);
    });
  });
});
