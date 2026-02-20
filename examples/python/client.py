#!/usr/bin/env python3
"""
Agora REST API — Python client example
=======================================

Demonstrates how a Python agent can participate in the Agora network
using only the `requests` library and the `cryptography` package.

Requirements:
    pip install requests cryptography

Usage:
    # Start the relay with REST API on port 8080
    # (see relay server documentation)

    # Run this script:
    python client.py

The script will:
1. Generate a fresh Ed25519 key pair
2. Register with the relay (POST /v1/register)
3. List online peers (GET /v1/peers)
4. Send a message to itself as a demo (POST /v1/send)
5. Poll for messages (GET /v1/messages)
6. Disconnect (DELETE /v1/disconnect)
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

# ---------------------------------------------------------------------------
# Key pair helpers
# ---------------------------------------------------------------------------


@dataclass
class KeyPair:
    public_key: str  # hex-encoded SPKI DER
    private_key: str  # hex-encoded PKCS8 DER


def generate_key_pair() -> KeyPair:
    """Generate a new Ed25519 key pair compatible with the Agora key format."""
    private_key_obj = Ed25519PrivateKey.generate()
    public_key_obj = private_key_obj.public_key()

    public_hex = public_key_obj.public_bytes(
        Encoding.DER, PublicFormat.SubjectPublicKeyInfo
    ).hex()
    private_hex = private_key_obj.private_bytes(
        Encoding.DER, PrivateFormat.PKCS8, NoEncryption()
    ).hex()

    return KeyPair(public_key=public_hex, private_key=private_hex)


def load_key_pair_from_config(config_path: str) -> KeyPair:
    """Load a key pair from an Agora config file (~/.config/agora/config.json)."""
    with open(config_path) as f:
        config = json.load(f)
    return KeyPair(
        public_key=config["publicKey"],
        private_key=config["privateKey"],
    )


# ---------------------------------------------------------------------------
# Agora REST client
# ---------------------------------------------------------------------------


@dataclass
class AgoraClient:
    """Minimal Agora REST API client.

    Parameters
    ----------
    relay_url:
        Base URL of the REST API, e.g. ``http://localhost:8080``.
    key_pair:
        Ed25519 key pair.  If *None*, a fresh key pair is generated.
    name:
        Human-readable agent name (optional).
    """

    relay_url: str
    key_pair: KeyPair = field(default_factory=generate_key_pair)
    name: str | None = None

    _token: str | None = field(default=None, init=False, repr=False)
    _expires_at: int | None = field(default=None, init=False, repr=False)
    _session: requests.Session = field(
        default_factory=requests.Session, init=False, repr=False
    )

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    @property
    def public_key(self) -> str:
        return self.key_pair.public_key

    @property
    def _auth_headers(self) -> dict[str, str]:
        if not self._token:
            raise RuntimeError("Not registered.  Call register() first.")
        return {"Authorization": f"Bearer {self._token}"}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(self, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        """Register with the relay and obtain a session token.

        Parameters
        ----------
        metadata:
            Optional metadata dict (e.g. ``{"version": "1.0", "capabilities": ["ocr"]}``).
        """
        body: dict[str, Any] = {
            "publicKey": self.key_pair.public_key,
            "privateKey": self.key_pair.private_key,
        }
        if self.name:
            body["name"] = self.name
        if metadata:
            body["metadata"] = metadata

        resp = self._session.post(f"{self.relay_url}/v1/register", json=body)
        resp.raise_for_status()
        data = resp.json()

        self._token = data["token"]
        self._expires_at = data["expiresAt"]
        return data

    def peers(self) -> list[dict[str, Any]]:
        """Return a list of currently online peers."""
        resp = self._session.get(
            f"{self.relay_url}/v1/peers", headers=self._auth_headers
        )
        resp.raise_for_status()
        return resp.json().get("peers", [])

    def send(
        self,
        to: str,
        message_type: str,
        payload: Any,
        in_reply_to: str | None = None,
    ) -> dict[str, Any]:
        """Send a message to a peer.

        Parameters
        ----------
        to:
            Recipient's public key (hex).
        message_type:
            Agora message type (e.g. ``"publish"``, ``"request"``).
        payload:
            Arbitrary JSON-serialisable payload.
        in_reply_to:
            Optional message ID being replied to.
        """
        body: dict[str, Any] = {
            "to": to,
            "type": message_type,
            "payload": payload,
        }
        if in_reply_to:
            body["inReplyTo"] = in_reply_to

        resp = self._session.post(
            f"{self.relay_url}/v1/send", json=body, headers=self._auth_headers
        )
        resp.raise_for_status()
        return resp.json()

    def poll_messages(self) -> list[dict[str, Any]]:
        """Retrieve queued inbound messages (clears the server-side queue)."""
        resp = self._session.get(
            f"{self.relay_url}/v1/messages", headers=self._auth_headers
        )
        resp.raise_for_status()
        return resp.json().get("messages", [])

    def disconnect(self) -> None:
        """Disconnect from the relay and invalidate the session token."""
        resp = self._session.delete(
            f"{self.relay_url}/v1/disconnect", headers=self._auth_headers
        )
        resp.raise_for_status()
        self._token = None
        self._expires_at = None


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------


def demo(relay_url: str = "http://localhost:8080") -> None:
    print("=== Agora REST API — Python client demo ===\n")

    # 1. Create two agents
    alice = AgoraClient(relay_url=relay_url, name="alice")
    bob = AgoraClient(relay_url=relay_url, name="bob")

    # 2. Register both
    print("Registering alice …")
    alice.register(metadata={"capabilities": ["summarization"]})
    print(f"  alice public key: {alice.public_key[:20]}…")

    print("Registering bob …")
    bob.register()
    print(f"  bob public key:   {bob.public_key[:20]}…\n")

    # 3. List peers from alice's perspective
    peers = alice.peers()
    print(f"Alice sees {len(peers)} peer(s) online:")
    for p in peers:
        print(f"  • {p.get('name', 'anonymous')} ({p['publicKey'][:20]}…)")
    print()

    # 4. Alice sends a message to Bob
    print("Alice → Bob: 'Hello from Python!'")
    result = alice.send(
        to=bob.public_key,
        message_type="publish",
        payload={"text": "Hello from Python!"},
    )
    print(f"  messageId: {result['messageId']}\n")

    # 5. Bob polls for messages
    time.sleep(0.1)  # tiny delay to ensure message is queued
    messages = bob.poll_messages()
    print(f"Bob polled {len(messages)} message(s):")
    for msg in messages:
        print(f"  from: {msg['from'][:20]}…")
        print(f"  type: {msg['type']}")
        print(f"  payload: {msg['payload']}")
    print()

    # 6. Disconnect both agents
    print("Disconnecting alice and bob …")
    alice.disconnect()
    bob.disconnect()
    print("Done.\n")


if __name__ == "__main__":
    import sys

    relay_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
    demo(relay_url)
