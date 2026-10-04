/**
 * Example: register a Cirkle webhook + verify an incoming signature.
 *
 * Two flows:
 *   1. Register the endpoint via `client.registerWebhook(...)`.
 *   2. Simulate an incoming webhook delivery by computing the
 *      HMAC-SHA256 signature with the SDK and round-trip-verifying it —
 *      exactly the flow an Express / Next.js / Hono receiver would use.
 *
 * The bottom of the file also shows a reference Next.js route handler
 * implementation for production use.
 */

import { CirkleVerify, CirkleError, SignatureVerificationError } from '../src/index';

const WEBHOOK_SECRET = 'whsec_demo_secret_min16chars';

async function main(): Promise<number> {
  const apiKey = process.env.CIRKLE_API_KEY;
  const baseUrl = process.env.CIRKLE_BASE_URL ?? 'https://cirkle-verify.vercel.app';
  const webhookUrl = process.env.CIRKLE_WEBHOOK_URL ?? 'https://example.com/webhook';

  // ─── 1. Register the webhook (skipped if no API key) ──────────
  if (apiKey) {
    console.log('── Register webhook ──────────────────────────────────');
    const client = new CirkleVerify({ apiKey, baseUrl });
    try {
      const endpoint = await client.registerWebhook({
        url: webhookUrl,
        events: ['verification.completed', 'verification.failed', 'fraud.detected'],
        secret: WEBHOOK_SECRET,
      });
      console.log(`  ID:        ${endpoint.id}`);
      console.log(`  URL:       ${endpoint.url}`);
      console.log(`  Events:    ${endpoint.events?.join(', ')}`);
      console.log(`  Active:    ${endpoint.active}`);
      console.log('  Algorithm: HMAC-SHA256');
      console.log('  Header:    X-Cirkle-Signature (sha256=<hex>)');
    } catch (e) {
      if (e instanceof CirkleError) {
        console.error(`  [${e.code ?? e.name}] ${e.message}`);
      } else {
        console.error('  Unexpected error:', e);
      }
      // continue to step 2 — the signature round-trip is local + offline
    }
  } else {
    console.log('── Skipping webhook registration (set CIRKLE_API_KEY to enable) ──');
  }

  // ─── 2. Simulate a round-trip ──────────────────────────────────
  console.log('\n── Simulated delivery ────────────────────────────────');
  const payload = {
    event: 'verification.completed',
    timestamp: '2026-01-01T00:00:00.000Z',
    data: {
      verificationId: 'v_demo_123',
      status: 'verified',
      docConfidence: 0.92,
      faceMatchScore: 88,
      livenessScore: 95,
    },
  };
  // Note: receivers MUST verify the raw bytes they got — never a
  // re-serialised JSON form (key ordering / whitespace can change the
  // signature). We replicate that here.
  const rawBody = JSON.stringify(payload);
  const sigHex = await CirkleVerify.computeWebhookSignature(rawBody, WEBHOOK_SECRET);
  const signatureHeader = CirkleVerify.formatSignature(sigHex);

  console.log(`  Body:      ${rawBody.slice(0, 80)}...`);
  console.log(`  Signature: ${signatureHeader}`);

  const ok = await CirkleVerify.verifyWebhookSignature(rawBody, WEBHOOK_SECRET, signatureHeader);
  console.log(`  Verified:  ${ok}`);
  if (!ok) {
    console.error('  ⚠ Signature did not verify — investigate.');
    return 1;
  }

  // Tamper with the body — verification should fail.
  const tampered = rawBody.replace('verified', 'rejected');
  const okTampered = await CirkleVerify.verifyWebhookSignature(
    tampered,
    WEBHOOK_SECRET,
    signatureHeader,
  );
  console.log(`  Tampered body verifies? ${okTampered} (expected: false)`);
  if (okTampered) {
    console.error('  ⚠ Tampered body passed verification — that is a bug.');
    return 1;
  }

  // Wrong secret — verification should fail.
  const okWrongSecret = await CirkleVerify.verifyWebhookSignature(
    rawBody,
    WEBHOOK_SECRET + 'x',
    signatureHeader,
  );
  console.log(`  Wrong-secret verifies? ${okWrongSecret} (expected: false)`);
  if (okWrongSecret) {
    console.error('  ⚠ Wrong secret passed verification — that is a bug.');
    return 1;
  }

  // Malformed headers — verification should reject with a typed error.
  for (const badHeader of ['', 'abc', 'sha256=', 'sha256=zz', 'invalid']) {
    try {
      await CirkleVerify.verifyWebhookSignature(rawBody, WEBHOOK_SECRET, badHeader);
      console.error(`  ⚠ Malformed header ${JSON.stringify(badHeader)} did not raise.`);
      return 1;
    } catch (e) {
      if (e instanceof SignatureVerificationError) {
        console.log(`  Malformed header ${JSON.stringify(badHeader)} → ${e.name}: ${e.message}`);
      } else {
        console.error(`  Unexpected error type for ${JSON.stringify(badHeader)}:`, e);
        return 1;
      }
    }
  }

  console.log('\nAll checks passed.');
  return 0;
}

// ─── Reference Next.js route handler ──────────────────────────────
//
// Drop the following into `app/api/webhook/route.ts` to receive webhook
// deliveries in a Next.js app. The key points are:
//
//   - `await req.text()` to get the RAW body bytes (not `req.json()`,
//     which round-trips through JSON parsing + re-stringification).
//   - `verifyWebhookSignature` rejects on malformed headers and
//     resolves false on signature mismatch — handle both as 401.
//   - Respond 2xx quickly so the server doesn't time out + retry.
//
//   import { NextRequest, NextResponse } from 'next/server';
//   import { CirkleVerify, SignatureVerificationError } from '@cirkle/verify';
//
//   const SECRET = process.env.CIRKLE_WEBHOOK_SECRET!;
//
//   export async function POST(req: NextRequest) {
//     const raw = await req.text();
//     const sig = req.headers.get('X-Cirkle-Signature') ?? '';
//     try {
//       const ok = await CirkleVerify.verifyWebhookSignature(raw, SECRET, sig);
//       if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
//     } catch (e) {
//       if (e instanceof SignatureVerificationError) {
//         return NextResponse.json({ error: e.message }, { status: 401 });
//       }
//       throw e;
//     }
//     const event = JSON.parse(raw);
//     await dispatch(event.event, event.data);
//     return NextResponse.json({ ok: true });
//   }

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('Uncaught:', e);
    process.exit(1);
  });
