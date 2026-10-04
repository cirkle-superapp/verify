/**
 * Cirkle Verify — JavaScript/TypeScript SDK entry point.
 *
 * Tree-shakeable named exports — import only what you use:
 *
 *   import { CirkleVerify, CirkleError } from '@cirkle/verify';
 *
 * Works in the browser, Node.js (18+), Bun, Deno, and edge runtimes —
 * anywhere the standard `fetch` API is available.
 *
 * Example (Node):
 *
 *   import { CirkleVerify } from '@cirkle/verify';
 *
 *   const client = new CirkleVerify({
 *     apiKey: process.env.CIRKLE_API_KEY!,
 *     baseUrl: 'http://localhost:3000',
 *   });
 *
 *   const result = await client.verifyDocument({
 *     image: 'id_card.jpg',
 *     docType: 'national_id',
 *     country: 'EG',
 *   });
 *   console.log(result.extractedFields?.fullNameAr);
 *
 * Example (browser — uses Blob/File inputs directly):
 *
 *   const file = input.files[0];
 *   const result = await client.verifyDocument({ image: file });
 *
 * Webhook verification (no client needed — static method):
 *
 *   const ok = await CirkleVerify.verifyWebhookSignature(rawBody, secret, sigHeader);
 *   if (!ok) return new Response('invalid signature', { status: 401 });
 */

export { CirkleVerify } from './client';
export type { CirkleVerifyConfig } from './client';

export * from './types';
export * from './errors';
export {
  // image helpers
  encodeImage,
  fileToDataUrl,
  blobToDataUrl,
  bytesToDataUrl,
  streamToArrayBuffer,
  // webhook helpers
  computeSignature,
  formatSignatureHeader,
  verifySignature,
  canonicalJson,
  // http / runtime helpers
  normalizeBaseUrl,
  toQueryString,
  isNodeRuntime,
  sleep,
} from './utils';

export const VERSION = '1.0.0';
