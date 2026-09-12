/**
 * Cirkle Face Match Mini-Service
 *
 * Persistent Bun server running @vladmandic/face-api with pre-loaded models.
 * Solves the Vercel cold-start problem: models load once and stay warm.
 *
 * Port: 3031
 * Endpoints:
 *   GET  /health     — health check
 *   POST /match      — compare selfie face to document photo
 *
 * Zero cost. No billing. No external API calls.
 */

const PORT = 3031;

let faceapi: any = null;
let modelsLoaded = false;

async function ensureFaceApi() {
  if (!faceapi) {
    console.log("[FACE] Loading @vladmandic/face-api...");
    faceapi = await import("@vladmandic/face-api");
  }
  if (!modelsLoaded) {
    const modelUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
    modelsLoaded = true;
    console.log("[FACE] Models loaded");
  }
  return faceapi;
}

// Pre-warm on startup
ensureFaceApi().catch((e) => console.error("[FACE] Init failed:", e.message));

async function getDescriptor(faceapi: any, dataUrl: string) {
  const img = await faceapi.fetchImage(dataUrl);
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return { descriptor: detection.descriptor, detection: detection.detection };
}

function compare(d1: Float32Array, d2: Float32Array) {
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    sum += (d1[i] - d2[i]) ** 2;
  }
  const distance = Math.sqrt(sum);
  const similarity = Math.max(0, Math.min(100, (1 - distance / 0.6) * 100));
  return { distance, similarity };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/health") {
      return Response.json({
        status: modelsLoaded ? "ready" : "initializing",
        port: PORT,
        modelsLoaded,
      }, { headers: cors });
    }

    if (url.pathname === "/match" && req.method === "POST") {
      try {
        const { selfie, document: docImage } = await req.json();
        if (!selfie || !docImage) {
          return Response.json({ error: "selfie and document required" }, { status: 400, headers: cors });
        }

        const fp = await ensureFaceApi();
        const t0 = Date.now();
        const [selfieFace, docFace] = await Promise.all([
          getDescriptor(fp, selfie),
          getDescriptor(fp, docImage),
        ]);
        const elapsed = Date.now() - t0;

        if (!selfieFace) {
          return Response.json({
            isMatch: false, samePerson: false, similarity: 0,
            reasoning: "No face detected in selfie.",
            elapsedMs: elapsed,
          }, { headers: cors });
        }
        if (!docFace) {
          return Response.json({
            isMatch: false, samePerson: false, similarity: 0,
            reasoning: "No face detected in document image.",
            elapsedMs: elapsed,
          }, { headers: cors });
        }

        const { distance, similarity } = compare(selfieFace.descriptor, docFace.descriptor);
        const isMatch = similarity >= 50;

        return Response.json({
          isMatch,
          samePerson: isMatch,
          similarity: Math.round(similarity),
          reasoning: `Euclidean distance: ${distance.toFixed(3)}, similarity: ${similarity.toFixed(1)}%`,
          elapsedMs: elapsed,
        }, { headers: cors });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: cors });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  },
});

console.log(`[FACE] Service listening on http://localhost:${PORT}`);
