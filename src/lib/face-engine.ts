/**
 * Self-hosted face matching engine using @vladmandic/face-api (TensorFlow.js).
 *
 * No external API calls — runs entirely on the server using TensorFlow.js.
 * Detects faces in both selfie and document images, extracts face descriptors
 * (128-dimensional embeddings), and compares them using Euclidean distance.
 *
 * License: MIT (@vladmandic/face-api)
 */

import * as faceapi from "@vladmandic/face-api";
import sharp from "sharp";
import { parseDataUrl } from "@/lib/image-server";
import type { FaceMatchResult } from "@/lib/verification-types";

let modelsLoaded = false;

/**
 * Load face-api.js models. Models are loaded once and cached.
 * Uses the @vladmandic/face-api built-in model weights.
 */
async function loadModels() {
  if (modelsLoaded) return;
  // @vladmandic/face-api loads models from CDN by default.
  // In production, we bundle them locally.
  const modelUrl = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
  ]);
  modelsLoaded = true;
}

/**
 * Convert a data URL to a TensorFlow.js tensor suitable for face-api.
 */
async function dataUrlToInput(dataUrl: string): Promise<faceapi.NetInput> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Invalid image data URL");

  // Resize to a reasonable size for face detection
  const resized = await sharp(parsed.buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 800, height: 800, fit: "inside" })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Create an HTMLImageElement-like object for face-api
  const buffer = resized;

  // face-api.js accepts Buffer directly in Node.js
  const img = await faceapi.fetchImage(`data:image/jpeg;base64,${buffer.toString("base64")}`);
  return img;
}

/**
 * Detect a face and extract its descriptor (128-d embedding).
 */
async function getFaceDescriptor(dataUrl: string): Promise<{ descriptor: Float32Array; detection: any } | null> {
  await loadModels();

  const img = await dataUrlToInput(dataUrl);

  // Detect face with landmarks and descriptor
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  return {
    descriptor: detection.descriptor,
    detection: detection.detection,
  };
}

/**
 * Compare two face descriptors using Euclidean distance.
 * Lower distance = more similar.
 *
 * Threshold guide:
 *  - < 0.4: same person (high confidence)
 *  - 0.4-0.6: likely same person
 *  - > 0.6: different person
 */
function compareDescriptors(d1: Float32Array, d2: Float32Array): { distance: number; similarity: number } {
  if (d1.length !== d2.length) {
    return { distance: 1, similarity: 0 };
  }
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  const distance = Math.sqrt(sum);
  // Convert distance to similarity score (0-100)
  // distance 0 → 100% similarity, distance 0.6 → 0% similarity
  const similarity = Math.max(0, Math.min(100, (1 - distance / 0.6) * 100));
  return { distance, similarity };
}

/**
 * Match a selfie face against a document photo.
 *
 * @param selfieDataUrl - base64 data URL of the selfie
 * @param documentDataUrl - base64 data URL of the document (containing a photo)
 * @returns FaceMatchResult with similarity score and match decision
 */
export async function matchFaceSelfHosted(
  selfieDataUrl: string,
  documentDataUrl: string
): Promise<FaceMatchResult> {
  try {
    // Detect faces in both images
    const [selfieFace, docFace] = await Promise.all([
      getFaceDescriptor(selfieDataUrl),
      getFaceDescriptor(documentDataUrl),
    ]);

    if (!selfieFace) {
      return {
        isMatch: false,
        samePerson: false,
        similarity: 0,
        reasoning: "No face detected in the selfie image. Please retake with better lighting and face the camera directly.",
      };
    }

    if (!docFace) {
      return {
        isMatch: false,
        samePerson: false,
        similarity: 0,
        reasoning: "No face detected in the document image. The document photo may be too small or unclear.",
      };
    }

    const { distance, similarity } = compareDescriptors(selfieFace.descriptor, docFace.descriptor);

    const isMatch = similarity >= 50; // 50% threshold (distance < 0.3)

    const reasoning = `Face descriptor Euclidean distance: ${distance.toFixed(3)}. ` +
      `Similarity: ${similarity.toFixed(1)}%. ` +
      `Selfie detection confidence: ${(selfieFace.detection.score * 100).toFixed(0)}%. ` +
      `Document detection confidence: ${(docFace.detection.score * 100).toFixed(0)}%.`;

    return {
      isMatch,
      samePerson: isMatch,
      similarity: Math.round(similarity),
      reasoning,
    };
  } catch (e: any) {
    return {
      isMatch: false,
      samePerson: false,
      similarity: 0,
      reasoning: `Face matching error: ${e?.message || "unknown"}. Using self-hosted face-api.js.`,
    };
  }
}
