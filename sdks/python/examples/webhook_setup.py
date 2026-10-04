"""Example: register a Cirkle webhook + verify an incoming signature.

Run with::

    CIRKLE_API_KEY=cvk_xxx python examples/webhook_setup.py

Demonstrates:

1. Registering a webhook endpoint (the SDK sends the request to the
   Cirkle webhook-system route with ``action=register``).
2. Simulating an incoming webhook delivery by computing the
   HMAC-SHA256 signature with the SDK and round-trip-verifying it —
   exactly the flow a Flask/FastAPI/Django receiver would use.

For a real-world Flask receiver, see the ``receive_webhook`` function at
the bottom of this file.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cirkle_verify import (  # noqa: E402
    CirkleError,
    CirkleVerify,
    ValidationError,
)

WEBHOOK_SECRET = "whsec_demo_secret_min16chars"


def main() -> int:
    api_key = os.environ.get("CIRKLE_API_KEY")
    base_url = os.environ.get("CIRKLE_BASE_URL", "https://cirkle-verify.vercel.app")
    webhook_url = os.environ.get("CIRKLE_WEBHOOK_URL", "https://example.com/webhook")

    if not api_key:
        print("Set CIRKLE_API_KEY environment variable first.")
        return 2

    client = CirkleVerify(api_key=api_key, base_url=base_url)

    # ─── 1. Register the webhook ────────────────────────────────
    try:
        endpoint = client.register_webhook(
            url=webhook_url,
            events=["verification.completed", "verification.failed", "fraud.detected"],
            secret=WEBHOOK_SECRET,
        )
    except ValidationError as e:
        print(f"Validation error: {e}")
        return 4
    except CirkleError as e:
        print(f"SDK error: {e}")
        return 1

    print("─── Webhook registered ─────────────────────────────")
    print(f"  ID:        {endpoint.id}")
    print(f"  URL:       {endpoint.url}")
    print(f"  Events:    {endpoint.events}")
    print(f"  Active:    {endpoint.active}")
    print(f"  Algorithm: HMAC-SHA256")
    print(f"  Header:    X-Cirkle-Signature (sha256=<hex>)")

    # ─── 2. Simulate a round-trip ────────────────────────────────
    payload = {
        "event": "verification.completed",
        "timestamp": "2026-01-01T00:00:00.000Z",
        "data": {
            "verificationId": "v_demo_123",
            "status": "verified",
            "docConfidence": 0.92,
            "faceMatchScore": 88,
            "livenessScore": 95,
        },
    }
    raw_body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature_hex = CirkleVerify.compute_webhook_signature(raw_body, WEBHOOK_SECRET)
    signature_header = CirkleVerify.format_signature(signature_hex)

    print()
    print("─── Simulated delivery ────────────────────────────")
    print(f"  Body:      {raw_body.decode()[:80]}...")
    print(f"  Signature: {signature_header}")

    ok = CirkleVerify.verify_webhook_signature(raw_body, WEBHOOK_SECRET, signature_header)
    print(f"  Verified:  {ok}")
    if not ok:
        print("  ⚠ Signature did not verify — investigate.")
        return 1

    # Tamper with the body and check verification fails.
    tampered = raw_body.replace(b"verified", b"rejected")
    ok_tampered = CirkleVerify.verify_webhook_signature(tampered, WEBHOOK_SECRET, signature_header)
    print(f"  Tampered body verifies? {ok_tampered} (expected: False)")
    if ok_tampered:
        print("  ⚠ Tampered body passed verification — that's a bug.")
        return 1

    print()
    print("All checks passed.")
    return 0


# ─── Reference receiver (Flask) ─────────────────────────────────
# Drop this into your Flask app to receive webhook deliveries:

def receive_webhook_example():  # pragma: no cover - reference only
    """Reference Flask receiver — shows how to wire the SDK into a real HTTP server."""
    # from flask import Flask, request, jsonify
    # app = Flask(__name__)
    #
    # @app.route("/webhook", methods=["POST"])
    # def _wh():
    #     raw = request.get_data()  # raw bytes — DO NOT use request.json
    #     sig = request.headers.get("X-Cirkle-Signature", "")
    #     if not CirkleVerify.verify_webhook_signature(raw, WEBHOOK_SECRET, sig):
    #         return jsonify({"error": "invalid signature"}), 401
    #     event = json.loads(raw)
    #     # dispatch on event["event"] ...
    #     return jsonify({"ok": True}), 200
    pass


if __name__ == "__main__":
    sys.exit(main())
