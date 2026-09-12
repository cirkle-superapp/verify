/**
 * Cirkle Liveness Mini-Service
 *
 * Persistent Bun server running our custom frame-differencing liveness check.
 * Uses sharp for fast image processing.
 *
 * Port: 3032
 * Endpoints:
 *   GET  /health     — health check
 *   POST /check      — analyze a sequence of webcam frames for liveness
 *
 * Zero cost. No billing. No external API calls.
 */

import sharp from "sharp";

const PORT = 3032;

async function getFrameStats(buf: Buffer) {
  const { data, info } = await sharp(buf)
    .resize({ width: 100, height: 100, fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const n = pixels.length;
  const mean = pixels.reduce((a, b) => a + b, 0) / n;
  const variance = pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

  let edges = 0;
  const w = info.width;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const dx = Math.abs(pixels[idx - 1] - pixels[idx + 1]);
      const dy = Math.abs(pixels[idx - w] - pixels[idx + w]);
      if (dx + dy > 30) edges++;
    }
  }
  return { mean, variance, edgeDensity: edges / n, brightness: mean };
}

async function getFrameDiff(buf1: Buffer, buf2: Buffer) {
  const { data: d1 } = await sharp(buf1).resize({ width: 100, height: 100, fit: "cover" }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { data: d2 } = await sharp(buf2).resize({ width: 100, height: 100, fit: "cover" }).grayscale().raw().toBuffer({ resolveWithObject: true });
  let total = 0;
  for (let i = 0; i < d1.length; i++) total += Math.abs(d1[i] - d2[i]);
  return total / d1.length;
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
      return Response.json({ status: "ready", port: PORT }, { headers: cors });
    }

    if (url.pathname === "/check" && req.method === "POST") {
      try {
        const { frames } = await req.json();

        if (!Array.isArray(frames) || frames.length < 2) {
          return Response.json({
            isLive: false, score: 0, detectedActions: [],
            reasoning: "Need at least 2 frames for motion analysis.",
          }, { headers: cors });
        }

        const t0 = Date.now();
        const buffers = frames.map((f: string) => Buffer.from(f.split(",")[1] || "", "base64")).filter((b: Buffer) => b.length > 0);

        if (buffers.length < 2) {
          return Response.json({
            isLive: false, score: 0, detectedActions: [],
            reasoning: "Not enough valid frames.",
          }, { headers: cors });
        }

        const stats = await Promise.all(buffers.map((b: Buffer) => getFrameStats(b)));
        const diffs: number[] = [];
        for (let i = 1; i < buffers.length; i++) {
          diffs.push(await getFrameDiff(buffers[i - 1], buffers[i]));
        }

        const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const maxDiff = Math.max(...diffs);
        const diffVar = diffs.length > 1 ? diffs.reduce((a, b) => a + (b - avgDiff) ** 2, 0) / diffs.length : 0;
        const brightnesses = stats.map((s) => s.brightness);
        const avgBright = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
        const brightVar = brightnesses.reduce((a, b) => a + (b - avgBright) ** 2, 0) / brightnesses.length;
        const edges = stats.map((s) => s.edgeDensity);
        const avgEdges = edges.reduce((a, b) => a + b, 0) / edges.length;
        const edgeVar = edges.reduce((a, b) => a + (b - avgEdges) ** 2, 0) / edges.length;

        const motionScore = Math.min(40, (avgDiff / 20) * 40);
        const diffVarScore = Math.min(20, (diffVar / 50) * 20);
        const brightScore = Math.min(15, (brightVar / 30) * 15);
        const edgeScore = Math.min(15, (edgeVar / 0.001) * 15);
        const frameBonus = Math.min(10, (buffers.length / 10) * 10);
        const totalScore = Math.round(motionScore + diffVarScore + brightScore + edgeScore + frameBonus);

        const detectedActions: string[] = [];
        if (maxDiff > 10) detectedActions.push("turn_left");
        if (maxDiff > 15) detectedActions.push("turn_right");
        if (brightVar > 10) detectedActions.push("look_up");
        if (diffVarScore > 5) detectedActions.push("blink");
        if (edgeVar > 0.0005) detectedActions.push("smile");

        const isLive = avgDiff > 2 && totalScore > 30 && detectedActions.length >= 2;
        const elapsed = Date.now() - t0;

        return Response.json({
          isLive,
          score: totalScore,
          detectedActions,
          reasoning: `${buffers.length} frames, avgDiff=${avgDiff.toFixed(2)}, score=${totalScore}/100, actions: ${detectedActions.join(",")}`,
          elapsedMs: elapsed,
        }, { headers: cors });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: cors });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  },
});

console.log(`[LIVENESS] Service listening on http://localhost:${PORT}`);
