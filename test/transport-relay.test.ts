import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { sendViaRelay } from '../src/transport/relay.js';
import WebSocket from 'ws';

describe('Relay Transport', () => {
  describe('sendViaRelay', () => {
    it('should send message via relay successfully', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      // Mock WebSocket
      let capturedMessages: string[] = [];
      let onOpenCallback: (() => void) | undefined;
      let onMessageCallback: ((data: WebSocket.Data) => void) | undefined;

      const mockWebSocket = {
        send: mock.fn((data: string) => {
          capturedMessages.push(data);
        }),
        on: mock.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'open') {
            onOpenCallback = callback as () => void;
          } else if (event === 'message') {
            onMessageCallback = callback as (data: WebSocket.Data) => void;
          }
        }),
        close: mock.fn(),
      };

      // @ts-expect-error - mocking WebSocket
      const originalWebSocket = global.WebSocket;
      // @ts-expect-error - mocking WebSocket
      global.WebSocket = mock.fn(() => mockWebSocket);

      // Start the send operation
      const sendPromise = sendViaRelay(
        {
          identity,
          relayUrl: 'wss://test-relay.example.com',
        },
        peerIdentity.publicKey,
        'publish',
        { text: 'Hello via relay' }
      );

      // Simulate connection open
      setTimeout(() => {
        if (onOpenCallback) {
          onOpenCallback();
        }
      }, 10);

      // Simulate registered response
      setTimeout(() => {
        if (onMessageCallback) {
          const registeredMsg = JSON.stringify({
            type: 'registered',
            publicKey: identity.publicKey,
          });
          onMessageCallback(registeredMsg);
        }
      }, 20);

      const result = await sendPromise;

      // @ts-expect-error - restoring WebSocket
      global.WebSocket = originalWebSocket;

      assert.strictEqual(result.ok, true);
      assert.strictEqual(capturedMessages.length, 2);

      // Check register message
      const registerMsg = JSON.parse(capturedMessages[0]);
      assert.strictEqual(registerMsg.type, 'register');
      assert.strictEqual(registerMsg.publicKey, identity.publicKey);

      // Check envelope message
      const envelopeMsg = JSON.parse(capturedMessages[1]);
      assert.strictEqual(envelopeMsg.type, 'message');
      assert.strictEqual(envelopeMsg.to, peerIdentity.publicKey);
      assert.ok(envelopeMsg.envelope);
      assert.strictEqual(envelopeMsg.envelope.sender, identity.publicKey);
      assert.strictEqual(envelopeMsg.envelope.type, 'publish');
    });

    it('should handle relay server error', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      let onOpenCallback: (() => void) | undefined;
      let onMessageCallback: ((data: WebSocket.Data) => void) | undefined;

      const mockWebSocket = {
        send: mock.fn(),
        on: mock.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'open') {
            onOpenCallback = callback as () => void;
          } else if (event === 'message') {
            onMessageCallback = callback as (data: WebSocket.Data) => void;
          }
        }),
        close: mock.fn(),
      };

      // @ts-expect-error - mocking WebSocket
      const originalWebSocket = global.WebSocket;
      // @ts-expect-error - mocking WebSocket
      global.WebSocket = mock.fn(() => mockWebSocket);

      const sendPromise = sendViaRelay(
        {
          identity,
          relayUrl: 'wss://test-relay.example.com',
        },
        peerIdentity.publicKey,
        'publish',
        { text: 'Hello' }
      );

      // Simulate connection open
      setTimeout(() => {
        if (onOpenCallback) {
          onOpenCallback();
        }
      }, 10);

      // Simulate error response
      setTimeout(() => {
        if (onMessageCallback) {
          const errorMsg = JSON.stringify({
            type: 'error',
            message: 'Peer not connected',
          });
          onMessageCallback(errorMsg);
        }
      }, 20);

      const result = await sendPromise;

      // @ts-expect-error - restoring WebSocket
      global.WebSocket = originalWebSocket;

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'Peer not connected');
    });

    it('should handle connection error', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      let onErrorCallback: ((err: Error) => void) | undefined;

      const mockWebSocket = {
        send: mock.fn(),
        on: mock.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'error') {
            onErrorCallback = callback as (err: Error) => void;
          }
        }),
        close: mock.fn(),
      };

      // @ts-expect-error - mocking WebSocket
      const originalWebSocket = global.WebSocket;
      // @ts-expect-error - mocking WebSocket
      global.WebSocket = mock.fn(() => mockWebSocket);

      const sendPromise = sendViaRelay(
        {
          identity,
          relayUrl: 'wss://test-relay.example.com',
        },
        peerIdentity.publicKey,
        'publish',
        { text: 'Hello' }
      );

      // Simulate connection error
      setTimeout(() => {
        if (onErrorCallback) {
          onErrorCallback(new Error('Connection refused'));
        }
      }, 10);

      const result = await sendPromise;

      // @ts-expect-error - restoring WebSocket
      global.WebSocket = originalWebSocket;

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'Connection refused');
    });
  });
});
