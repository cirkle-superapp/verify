# Cirkle Verify — JavaScript / TypeScript SDK

Official JavaScript/TypeScript SDK for the [Cirkle Identity Verification](https://cirkle-verify.vercel.app) platform.

Cirkle is a **self-hosted** identity verification service: document OCR, face
match, liveness, MRZ parsing, GDPR data export. No external AI providers — all
processing runs on your Cirkle deployment.

- Works in **browser**, **Node.js 18+**, **Bun**, **Deno**, and edge runtimes.
- Single client class (`CirkleVerify`) — async throughout (uses `fetch`).
- **TypeScript** types for every API method.
- **Tree-shakeable** named exports.
- **ESM + CommonJS** dual build (consumers can `import` or `require`).
- **Automatic retry** on 5xx with exponential backoff.
- **Rate-limit aware** (respects `Retry-After`).
- **HMAC-SHA256 webhook signature verification** via the Web Crypto API.
- **Image helpers** — accepts `File`, `Blob`, `Uint8Array`, `data:` URL, or (Node)
  filesystem path.

## Installation

```bash
npm install @cirkle/verify
# or
bun add @cirkle/verify
# or
pnpm add @cirkle/verify
```

## Quickstart

```typescript
import { CirkleVerify, CirkleError } from '@cirkle/verify';

const client = new CirkleVerify({
  apiKey: process.env.CIRKLE_API_KEY!, // 'cvk_live_...'
  baseUrl: 'https://cirkle-verify.vercel.app', // or http://localhost:3000
});

try {
  const result = await client.verifyDocument({
    image: 'id_card.jpg', // path (Node) OR data URL OR Blob/File OR Uint8Array
    docType: 'national_id',
    country: 'EG',
  });
  console.log(result.extractedFields?.fullNameAr);
  console.log(result.extractedFields?.nationalId);
  console.log('confidence:', result.extractedFields?.confidence);
} catch (e) {
  if (e instanceof CirkleError) {
    console.error(`[SDK] ${e.name}: ${e.message}`);
  } else {
    console.error(e);
  }
}
```

## API surface

| Method              | Endpoint                          | Returns              |
| ------------------- | --------------------------------- | -------------------- |
| `verifyDocument()`  | `POST /api/verify/document`       | `VerificationResult` |
| `checkLiveness()`   | `POST /api/verify/liveness`       | `LivenessResult`    |
| `faceMatch()`        | `POST /api/verify/face-match`     | `FaceMatchResult`    |
| `validateId()`       | `POST /api/verify/validate-id`    | `IdValidationResult`  |
| `parseMrz()`         | `POST /api/verify/parse-mrz`      | `MrzParseResult`     |
| `registerWebhook()`  | `POST /api/v1/verify/webhook-system` (action=register) | `WebhookEndpoint` |
| `getCertificate()`   | `POST /api/v1/verify/certificate` | `Certificate`        |
| `exportData()`       | `GET  /api/v1/verify/gdpr/export`  | `GdprExport`         |

Every method is async (because `fetch` is). Webhook signature verification is
a static method on `CirkleVerify`:

```typescript
const ok = await CirkleVerify.verifyWebhookSignature(rawBody, secret, sigHeader);
```

## Image input

All image-accepting methods accept any of:

- **`string`** starting with `data:` → returned as-is.
- **`string`** not starting with `data:` → treated as a Node filesystem path (Node
  only — in the browser, paths are meaningless and will throw `InvalidImageError`).
- **`Uint8Array` / `ArrayBuffer`** → encoded to base64.
- **`Blob` / `File`** → read via `Blob.arrayBuffer()` or `FileReader`.
- **`ReadableStream<Uint8Array>`** → consumed fully into a `Uint8Array`.

```typescript
// Node
await client.verifyDocument({ image: 'id_card.jpg' });
await client.verifyDocument({ image: fs.readFileSync('id_card.jpg') });
await client.verifyDocument({ image: 'data:image/png;base64,iVBOR...' });

// Browser
await client.verifyDocument({ image: fileInput.files[0] });
await client.verifyDocument({ image: await fetch('/some.jpg').then(r => r.blob()) });
```

## Retries & rate limits

- **5xx responses** are retried up to 3 times with exponential backoff
  (250ms → 500ms → 1000ms). Override with `new CirkleVerify({ maxRetries: 0 })`.
- **429 responses** are honoured automatically: the SDK sleeps for
  `Retry-After` seconds (capped at 60s) and retries once. After that a
  `RateLimitError` is raised.
- **Network errors** (DNS, TCP, TLS, timeouts) are also retried.
- **4xx responses** are never retried — they surface immediately as the
  matching exception.

## Webhook signature verification

The server signs every webhook delivery with HMAC-SHA256 using the secret you
registered. Verify it on receipt:

```typescript
import { CirkleVerify } from '@cirkle/verify';

async function handler(req: Request): Promise<Response> {
  const rawBody = await req.text(); // raw bytes — DO NOT use req.json()
  const sig = req.headers.get('X-Cirkle-Signature') ?? '';
  const secret = process.env.CIRKLE_WEBHOOK_SECRET!;

  const ok = await CirkleVerify.verifyWebhookSignature(rawBody, secret, sig);
  if (!ok) return new Response('invalid signature', { status: 401 });

  const event = JSON.parse(rawBody);
  await handleEvent(event.event, event.data);
  return new Response('ok', { status: 200 });
}
```

The comparison is constant-time (XOR + accumulate), so it is safe against
timing attacks.

## Streaming large payloads

For large GDPR exports, use `client.stream(method, path, opts)` to get the raw
`Response` and read `response.body` directly:

```typescript
const resp = await client.stream('GET', '/api/v1/verify/gdpr/export', {
  params: { user_id: 'user_abc', download: '1' },
});
const out = fs.createWriteStream('export.json');
const reader = resp.body!.getReader();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  out.write(value);
}
```

## Exception hierarchy

```
CirkleError
├── AuthenticationError     (401)
├── AuthorizationError      (403)
├── ValidationError          (400)
├── NotFoundError            (404)
├── RateLimitError           (429) — exposes .retryAfter
├── ServerError              (5xx) — exposes .status
├── ApiError                 (other non-2xx)
├── NetworkError             (DNS/TCP/TLS/timeout)
├── InvalidImageError        (bad image input)
└── SignatureVerificationError (malformed signature header)
```

## Examples

See the `examples/` directory for complete scripts:

| Example | What it shows |
| ------- | ------------- |
| `verify-browser.tsx` | A React component that uploads a document + selfie, runs the full verification flow |
| `verify-node.ts` | Node-side verification using filesystem paths |
| `webhook-verify.ts` | Verifying an incoming webhook signature in a Next.js route handler |

## License

MIT
