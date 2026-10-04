# Cirkle Verify — Python SDK

Official Python SDK for the [Cirkle Identity Verification](https://cirkle-verify.vercel.app) platform.

Cirkle is a **self-hosted** identity verification service: document OCR, face
match, liveness, MRZ parsing, GDPR data export. No external AI providers —
all processing runs on your Cirkle deployment.

- Python 3.8+
- Sync + async (`httpx`) clients
- Pydantic models (optional dep)
- Retries on 5xx with exponential backoff
- Rate-limit aware (respects `Retry-After`)
- HMAC-SHA256 webhook signature verification
- Type hints throughout

## Installation

```bash
pip install cirkle-verify[all]
# or, sync-only with no deps:
pip install cirkle-verify
# or, async only:
pip install cirkle-verify[async]
```

## Quickstart

```python
from cirkle_verify import CirkleVerify, CirkleError

client = CirkleVerify(
    api_key="cvk_live_xxx",
    base_url="https://cirkle-verify.vercel.app",  # or http://localhost:3000 for local dev
)

try:
    result = client.verify_document(
        image_path="id_card.jpg",
        doc_type="national_id",
        country="EG",
    )
    print(result.extracted_fields.full_name_ar)
    print(result.extracted_fields.national_id)
    print(f"confidence: {result.extracted_fields.confidence:.2f}")
except CirkleError as e:
    print(f"verification failed: [{e.code}] {e.message}")
```

## API surface

| Method                    | Endpoint                          | Returns                |
| ------------------------- | --------------------------------- | ---------------------- |
| `verify_document(...)`    | `POST /api/verify/document`       | `VerificationResult`   |
| `check_liveness(...)`     | `POST /api/verify/liveness`       | `LivenessResult`      |
| `face_match(...)`         | `POST /api/verify/face-match`     | `FaceMatchResult`      |
| `validate_id(...)`        | `POST /api/verify/validate-id`    | `IdValidationResult`   |
| `parse_mrz(...)`          | `POST /api/verify/parse-mrz`      | `MrzParseResult`       |
| `register_webhook(...)`   | `POST /api/v1/verify/webhook-system` (action=register) | `WebhookEndpoint` |
| `get_certificate(...)`    | `POST /api/v1/verify/certificate` | `Certificate`          |
| `export_data(...)`        | `GET  /api/v1/verify/gdpr/export`  | `GdprExport`           |

Each method has an async twin on `AsyncCirkleVerify` (`verify_document_async`, `check_liveness_async`, ...).

## Image input

All image-accepting methods take any of:
- a **filesystem path** (str): `"id_card.jpg"` — SDK loads + base64-encodes
- a **data URL** (str): `"data:image/jpeg;base64,/9j/4AAQ..."`
- **raw bytes**: `b"\xff\xd8\xff..."`

```python
client.verify_document(image_path="id_card.jpg")
client.verify_document(image="data:image/png;base64,iVBOR...")
client.face_match(document_image=b"\xff\xd8...", selfie_image="selfie.jpg")
```

## Retries & rate limits

- **5xx responses** are retried up to 3 times with exponential backoff
  (250ms → 500ms → 1000ms). Override with `CirkleVerify(api_key, max_retries=0)`.
- **429 responses** are honoured automatically: the SDK sleeps for
  `Retry-After` seconds (capped at 60s) and retries once. After that a
  `RateLimitError` is raised.
- **4xx responses** are never retried — they surface immediately as the
  matching exception (`ValidationError`, `AuthenticationError`, etc.).

## Async client

```python
import asyncio
from cirkle_verify import AsyncCirkleVerify

async def main():
    client = AsyncCirkleVerify(api_key="cvk_live_xxx")
    result = await client.verify_document_async(image_path="id_card.jpg")
    print(result.extracted_fields.full_name_en)

asyncio.run(main())
```

`AsyncCirkleVerify` requires `pip install httpx`.

## Webhook signature verification

The server signs every webhook delivery with HMAC-SHA256 using the secret you
registered. Verify it on receipt:

```python
from cirkle_verify import CirkleVerify

raw_body = b'{"event":"verification.completed",...}'  # raw bytes from the HTTP request
signature_header = request.headers.get("X-Cirkle-Signature", "")  # "sha256=<hex>"
secret = "whsec_your_16_char_min_secret"

if CirkleVerify.verify_webhook_signature(raw_body, secret, signature_header):
    payload = json.loads(raw_body)
    handle_event(payload["event"], payload["data"])
else:
    return 401
```

The comparison is constant-time (`hmac.compare_digest`) so it is safe
against timing attacks.

## Exception hierarchy

```
CirkleError
├── AuthenticationError     (401)
├── AuthorizationError     (403)
├── ValidationError        (400)
├── NotFoundError          (404)
├── RateLimitError         (429) — exposes .retry_after
├── ServerError            (5xx) — exposes .status
├── ApiError               (other non-2xx)
├── NetworkError           (DNS/TCP/TLS/timeout)
├── InvalidImageError      (bad image input)
└── SignatureVerificationError (malformed signature header)
```

## Examples

See the `examples/` directory for complete scripts:

| Example | What it shows |
| ------- | ------------- |
| `verify_document.py` | Full document-verification flow with image path + error handling |
| `check_liveness.py` | Submitting webcam frames + a challenge type |
| `face_match.py` | Comparing a document photo to a selfie |
| `webhook_setup.py` | Registering a webhook + verifying an incoming signature |

## License

MIT
