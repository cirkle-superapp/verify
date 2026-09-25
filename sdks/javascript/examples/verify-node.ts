/**
 * Example: Node.js verification flow — document, liveness, face match,
 * validate ID, parse MRZ, get a certificate, and download the GDPR
 * export. All image inputs are filesystem paths.
 *
 * Run with:
 *
 *   CIRKLE_API_KEY=cvk_xxx bun sdks/javascript/examples/verify-node.ts \
 *     --doc id_card.jpg --selfie selfie.jpg --frames f1.jpg f2.jpg f3.jpg
 */

import { parseArgs } from 'node:util';
import path from 'node:path';

// Allow running directly from a checkout (without install).
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { CirkleVerify, CirkleError } = require_('../src/index.ts') as typeof import('../src/index.ts');

interface Args {
  doc?: string;
  selfie?: string;
  frames: string[];
  mrz?: string;
  id?: string;
  country: string;
}

function parseCLIArgs(): Args {
  const { values } = parseArgs({
    options: {
      doc: { type: 'string' },
      selfie: { type: 'string' },
      frames: { type: 'string', default: '' },
      mrz: { type: 'string' },
      id: { type: 'string' },
      country: { type: 'string', default: 'EG' },
    },
    allowPositionals: false,
  });
  const frames = (values.frames as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    doc: values.doc as string | undefined,
    selfie: values.selfie as string | undefined,
    frames,
    mrz: values.mrz as string | undefined,
    id: values.id as string | undefined,
    country: (values.country as string) || 'EG',
  };
}

function banner(title: string): void {
  console.log('\n── ' + title + ' '.repeat(Math.max(0, 64 - title.length)) + '──\n');
}

async function main(): Promise<number> {
  const apiKey = process.env.CIRKLE_API_KEY;
  const baseUrl = process.env.CIRKLE_BASE_URL ?? 'https://cirkle-verify.vercel.app';
  if (!apiKey) {
    console.error('Set CIRKLE_API_KEY first.');
    return 2;
  }

  const args = parseCLIArgs();
  const client = new CirkleVerify({ apiKey, baseUrl });

  // ─── 1. Verify a document ───────────────────────────────────────
  if (args.doc) {
    banner('1. Document verification');
    try {
      const result = await client.verifyDocument({
        image: path.resolve(args.doc),
        docType: 'national_id',
        country: args.country,
      });
      const f = result.extractedFields;
      console.log(`  Name (ar):    ${f?.fullNameAr}`);
      console.log(`  Name (en):    ${f?.fullNameEn}`);
      console.log(`  National ID:  ${f?.nationalId}`);
      console.log(`  Birth date:   ${f?.birthDate}`);
      console.log(`  Gender:       ${f?.gender}`);
      console.log(`  Confidence:   ${f?.confidence}`);
      console.log(`  Engine:       ${result.engine}`);
    } catch (e) {
      handleErr(e);
    }
  }

  // ─── 2. Check liveness ──────────────────────────────────────────
  if (args.frames.length > 0) {
    banner('2. Liveness check');
    try {
      const result = await client.checkLiveness({
        frames: args.frames.map((p) => path.resolve(p)),
        challengeType: 'turn_left',
      });
      console.log(`  Passed:       ${result.passed ?? result.isLive}`);
      console.log(`  Score:        ${result.score}`);
      console.log(`  Actions:      ${result.detectedActions?.join(', ')}`);
      if (result.signals) {
        console.log(`  Motion:        ${result.signals.motionScore}`);
        console.log(`  Challenge:     ${result.signals.challengeScore}`);
        console.log(`  Print attack:  ${result.signals.printAttackScore}`);
        console.log(`  Total (pro):   ${result.signals.totalScore}`);
      }
    } catch (e) {
      handleErr(e);
    }
  }

  // ─── 3. Face match ───────────────────────────────────────────────
  if (args.doc && args.selfie) {
    banner('3. Face match');
    try {
      const match = await client.faceMatch({
        documentImage: path.resolve(args.doc),
        selfieImage: path.resolve(args.selfie),
      });
      const matched = match.matched ?? match.isMatch;
      console.log(`  Matched:      ${matched}`);
      console.log(`  Score:        ${match.score ?? match.similarity}`);
      console.log(`  Same person: ${match.samePerson}`);
      if (match.consensus) {
        console.log(`  Consensus:    ${match.consensus.verdict} (${match.consensus.successful}/${match.consensus.total})`);
      }
    } catch (e) {
      handleErr(e);
    }
  }

  // ─── 4. Validate ID ──────────────────────────────────────────────
  if (args.id) {
    banner('4. ID validation');
    try {
      const v = await client.validateId({ country: args.country, id: args.id });
      console.log(`  Is valid:      ${v.isValid ?? v.valid}`);
      console.log(`  Checksum valid: ${v.checksumValid}`);
      console.log(`  Birth date:    ${v.birthDate}`);
      console.log(`  Gender:        ${v.gender}`);
    } catch (e) {
      handleErr(e);
    }
  }

  // ─── 5. Parse MRZ ────────────────────────────────────────────────
  if (args.mrz) {
    banner('5. MRZ parse');
    try {
      const m = await client.parseMrz({ mrz: args.mrz });
      console.log(`  Format:        ${m.format}`);
      console.log(`  Doc no:        ${m.documentNumber}`);
      console.log(`  Issuer:        ${m.issuingCountry}`);
      console.log(`  Name:          ${m.name}`);
      console.log(`  Sex:           ${m.sex}`);
      console.log(`  Birth date:    ${m.birthDate}`);
      console.log(`  Expiry date:   ${m.expiryDate}`);
      console.log(`  Nationality:   ${m.nationality}`);
      if (m.checkDigits) {
        console.log(`  Check digits:  ${JSON.stringify(m.checkDigits)}`);
      }
    } catch (e) {
      handleErr(e);
    }
  }

  // ─── 6. Get a certificate + export GDPR data ─────────────────────
  banner('6. Certificate + GDPR export');
  try {
    const cert = await client.getCertificate({
      verificationId: 'v_demo_123',
      subject: { fullNameEn: 'Mohamed Salah', docType: 'national_id', nationality: 'EG' },
      result: { status: 'verified', overallScore: 92, docConfidence: 0.9, faceMatchScore: 88, livenessScore: 95 },
      layers: {
        aiConsensus: { providers: 5, agreement: 0.85, verdict: 'unanimous' },
        ocrPostProcessing: true,
      },
    });
    console.log(`  Cert ID:       ${cert.certificateId ?? cert.id}`);
    console.log(`  Issued at:     ${cert.issuedAt ?? cert.metadata?.issuedAt}`);
    console.log(`  Expires at:    ${cert.expiresAt ?? cert.metadata?.expiresAt}`);
    console.log(`  Signature:     ${cert.signature?.value?.slice(0, 24)}...`);
    console.log(`  Verify URL:    ${cert.verifyUrl}`);
  } catch (e) {
    handleErr(e);
  }
  try {
    const exportResult = await client.exportData({ userId: 'user_abc' });
    console.log(`  Export hash:   ${exportResult.hash}`);
    console.log(`  Download URL:  ${exportResult.downloadUrl ?? exportResult.download_url}`);
    console.log(`  Regulation:    ${exportResult.regulation}`);
  } catch (e) {
    handleErr(e);
  }

  return 0;
}

function handleErr(e: unknown): void {
  if (e instanceof CirkleError) {
    console.error(`  [${e.code ?? e.name}] ${e.message}`);
  } else {
    console.error('  Error:', e);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('Uncaught:', e);
    process.exit(1);
  });
