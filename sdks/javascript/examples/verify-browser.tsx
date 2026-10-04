/**
 * Example: browser-side document + selfie verification in a React app.
 *
 * Run this in any React 18+/19 app that already has `@cirkle/verify`
 * installed. The component lets a user pick an ID-card image and a
 * selfie, then runs the document-extraction + face-match flow.
 *
 * Important: this example ships the API key in the browser bundle — only
 * use it with a `cvk_test_*` key that's locked down to your app origin.
 * For production you'll usually want a small backend endpoint that
 * forwards to Cirkle so your live key never ships to the client.
 */

import * as React from 'react';
import {
  CirkleError,
  CirkleVerify,
  FaceMatchResult,
  VerificationResult,
} from '@cirkle/verify';

const client = new CirkleVerify({
  apiKey: process.env.NEXT_PUBLIC_CIRKLE_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_CIRKLE_BASE_URL ?? 'https://cirkle-verify.vercel.app',
});

export function VerifyBrowserExample(): JSX.Element {
  const [docFile, setDocFile] = React.useState<File | null>(null);
  const [selfieFile, setSelfieFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState<'idle' | 'doc' | 'face'>('idle');
  const [docResult, setDocResult] = React.useState<VerificationResult | null>(null);
  const [faceResult, setFaceResult] = React.useState<FaceMatchResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleVerify(): Promise<void> {
    if (!docFile) {
      setError('Please select an ID-card image.');
      return;
    }
    setError(null);
    setDocResult(null);
    setFaceResult(null);

    setLoading('doc');
    try {
      const doc = await client.verifyDocument({
        image: docFile,
        docType: 'national_id',
        country: 'EG',
      });
      setDocResult(doc);
      if (selfieFile) {
        setLoading('face');
        const face = await client.faceMatch({
          // Use the same document image as the comparison source.
          documentImage: docFile,
          selfieImage: selfieFile,
        });
        setFaceResult(face);
      }
    } catch (e) {
      if (e instanceof CirkleError) {
        setError(`${e.name}: ${e.message}`);
      } else {
        setError((e as Error).message ?? String(e));
      }
    } finally {
      setLoading('idle');
    }
  }

  return (
    <div style={{ maxWidth: 540, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h2>Cirkle Verify — Browser flow</h2>

      <label style={{ display: 'block', margin: '8px 0' }}>
        ID card image:
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <label style={{ display: 'block', margin: '8px 0' }}>
        Selfie (optional — enables face match):
        <input
          type="file"
          accept="image/*"
          capture="user"
          onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <button
        type="button"
        onClick={() => void handleVerify()}
        disabled={loading !== 'idle' || !docFile}
      >
        {loading === 'doc' ? 'Extracting document…' : loading === 'face' ? 'Matching face…' : 'Verify'}
      </button>

      {error && (
        <p role="alert" style={{ color: '#c00' }}>
          {error}
        </p>
      )}

      {docResult?.extractedFields && (
        <pre
          style={{
            background: '#f4f4f5',
            padding: 12,
            borderRadius: 8,
            overflow: 'auto',
          }}
        >
          {JSON.stringify(docResult.extractedFields, null, 2)}
        </pre>
      )}

      {faceResult && (
        <div style={{ marginTop: 16 }}>
          <strong>Face match:</strong> {String(faceResult.matched ?? faceResult.isMatch)}{' '}
          (score: {faceResult.score ?? faceResult.similarity})
        </div>
      )}
    </div>
  );
}

export default VerifyBrowserExample;
