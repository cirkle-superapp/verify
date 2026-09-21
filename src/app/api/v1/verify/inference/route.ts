import { NextRequest, NextResponse } from "next/server";
import {
  isKnownModelName,
  listAvailableModels,
  loadModel,
  runInference,
} from "@/lib/model-serving";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — the inference endpoint is cross-origin accessible so
 * the Cirkle web client (and third-party integrators) can POST feature
 * vectors from any origin.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/inference
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/inference
 *
 * Lists all .npz models currently on disk under models/, including their
 * on-disk byte size and the accuracy recorded in the .pt side-car metadata.
 *
 * Response 200:
 *   {
 *     "models": [{ name, size, accuracy }],
 *     "count": number,
 *     "modelsDir": "models/"
 *   }
 */
export async function GET() {
  const models = listAvailableModels();
  return NextResponse.json(
    {
      models,
      count: models.length,
      modelsDir: "models/",
    },
    { headers: CORS_HEADERS },
  );
}

/**
 * POST /api/v1/verify/inference
 *
 * Body: { model: "liveness_advanced"|"face_attributes"|"fraud_ring_detector"|"mrz_validator",
 *         features: number[] }
 *
 * Runs a linear-logistic forward pass on the named model:
 *   z            = bias + Σ features[i] * weights[i]
 *   p            = sigmoid(z)
 *   prediction   = p > 0.5 ? 1 : 0
 *   confidence   = max(p, 1 - p)
 *   probabilities = [1 - p, p]
 *
 * Status codes:
 *   200 — prediction computed; body includes `prediction`, `confidence`,
 *         `probabilities`, `processingTimeMs`, `model`, `featureSize`,
 *         `expectedSize` and (if features were padded/truncated) the
 *         `featureCountAdjusted` flag set to true.
 *   400 — body missing `model` or `features`, or `features` is not a
 *         non-empty number[].
 *   404 — model file `models/<name>.npz` does not exist on disk; the
 *         response body lists `availableModels` so the caller can pick.
 *
 * If the input feature vector length does not match the model's expected
 * input size, the vector is zero-padded or right-truncated so a prediction
 * is always returned for known models; the `featureCountAdjusted` flag
 * surfaces this so callers can decide whether to re-send the full vector.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const modelName = (body as { model?: unknown } | null)?.model;
  const features = (body as { features?: unknown } | null)?.features;

  // Validate model name
  if (typeof modelName !== "string" || modelName.length === 0) {
    return NextResponse.json(
      {
        error: "missing_model",
        message: "Request body must include a non-empty `model` string.",
        availableModels: listAvailableModels().map((m) => m.name),
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!isKnownModelName(modelName)) {
    return NextResponse.json(
      {
        error: "unknown_model",
        message: `Unknown model "${modelName}". Supported: liveness_advanced, face_attributes, fraud_ring_detector, mrz_validator.`,
        availableModels: listAvailableModels().map((m) => m.name),
      },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // Validate features: must be a non-empty array of finite numbers
  if (!Array.isArray(features) || features.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_features",
        message: "`features` must be a non-empty number[].",
        model: modelName,
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const feats = features as unknown[];
  const badIdx = feats.findIndex((v) => typeof v !== "number" || !Number.isFinite(v));
  if (badIdx >= 0) {
    return NextResponse.json(
      {
        error: "invalid_features",
        message: `features[${badIdx}] is not a finite number.`,
        model: modelName,
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Load model — if .npz file missing, return 404 with available models list
  const loaded = loadModel(modelName);
  if (!loaded) {
    return NextResponse.json(
      {
        error: "model_not_found",
        message: `Model file models/${modelName}.npz does not exist. Run \`python3 training/train.py --model ${modelName} --epochs 10\` to train it.`,
        model: modelName,
        availableModels: listAvailableModels(),
      },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // Run inference
  const { result, featureCountAdjusted, expectedSize } = runInference(
    modelName,
    feats as number[],
  );
  if (!result) {
    return NextResponse.json(
      {
        error: "inference_failed",
        message: "Could not run inference on the loaded model (weights unreadable).",
        model: modelName,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  const processingTimeMs = Date.now() - t0;

  return NextResponse.json(
    {
      model: modelName,
      prediction: result.prediction,
      confidence: result.confidence,
      probabilities: result.probabilities,
      processingTimeMs,
      featureSize: feats.length,
      expectedSize,
      featureCountAdjusted,
      label: result.prediction === 1 ? "positive" : "negative",
    },
    { status: 200, headers: CORS_HEADERS },
  );
}
