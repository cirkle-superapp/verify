import {
  scoreFaceImageQuality,
  estimatePoseFromLandmarks,
} from "../src/lib/face-quality";
import {
  computeLBP,
  computeFFT,
  checkLivenessPro,
} from "../src/lib/liveness-pro";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra ?? ""); }
}

// 1. estimatePoseFromLandmarks — 5-point frontal
const frontal5 = [
  { x: 60, y: 40 },  { x: 140, y: 40 }, { x: 100, y: 70 },
  { x: 70, y: 100 }, { x: 130, y: 100 },
];
const poseFrontal = estimatePoseFromLandmarks(frontal5);
check("pose frontal yaw≈0", Math.abs(poseFrontal.yaw) < 5, `yaw=${poseFrontal.yaw}`);
check("pose frontal pitch≈0", Math.abs(poseFrontal.pitch) < 15, `pitch=${poseFrontal.pitch}`);
check("pose frontal roll≈0", Math.abs(poseFrontal.roll) < 5, `roll=${poseFrontal.roll}`);

// 2. turned right (nose shifted right of midpoint)
const turnRight5 = [
  { x: 60, y: 40 },  { x: 140, y: 40 }, { x: 130, y: 70 },
  { x: 90, y: 100 }, { x: 140, y: 100 },
];
const poseRight = estimatePoseFromLandmarks(turnRight5);
check("pose turned right yaw>0", poseRight.yaw > 10, `yaw=${poseRight.yaw}`);

// 3. roll tilt (left eye lower than right)
const tilted = [
  { x: 60, y: 30 },  { x: 140, y: 50 }, { x: 100, y: 70 },
  { x: 70, y: 100 }, { x: 130, y: 100 },
];
const poseTilt = estimatePoseFromLandmarks(tilted);
check("pose roll tilted CW (positive)", poseTilt.roll > 5, `roll=${poseTilt.roll}`);

// 4. 68-point format (auto-detected)
const l68: Array<{x:number;y:number}> = Array.from({length: 68}, (_, i) => ({
  x: 50 + (i % 10) * 5,
  y: 30 + Math.floor(i / 10) * 5,
}));
const pose68 = estimatePoseFromLandmarks(l68);
check("pose 68pt returns finite", Number.isFinite(pose68.yaw) && Number.isFinite(pose68.pitch) && Number.isFinite(pose68.roll));

// 5. empty input returns zeros
const pose0 = estimatePoseFromLandmarks([]);
check("pose empty returns zeros", pose0.yaw === 0 && pose0.pitch === 0 && pose0.roll === 0);

// 6. computeLBP — uniform image (all same value) → concentrated histogram → HIGH variance
const uniform = new Uint8Array(30 * 30).fill(128);
const lbpUniform = computeLBP(uniform, 30, 30);
check("LBP uniform variance > 0", lbpUniform > 0, `var=${lbpUniform}`);

// 7. computeLBP — varied image → spread histogram → LOW variance (less than uniform)
const varied = new Uint8Array(30 * 30);
for (let i = 0; i < varied.length; i++) varied[i] = Math.floor(Math.random() * 256);
const lbpVaried = computeLBP(varied, 30, 30);
check("LBP varied < uniform variance", lbpVaried < lbpUniform, `varied=${lbpVaried} uniform=${lbpUniform}`);

// 8. computeLBP — tiny input returns 0
check("LBP tiny input returns 0", computeLBP(new Uint8Array(0), 0, 0) === 0);

// 9. computeFFT — pure cosine should have peak at its frequency bin
const n = 64;
const sample = new Float32Array(n);
for (let i = 0; i < n; i++) sample[i] = Math.cos(2 * Math.PI * 4 * i / n); // bin 4
const fft = computeFFT(sample);
check("FFT returns arrays of input length", fft.magnitude.length === n && fft.phase.length === n);
let peakBin = 1;
for (let i = 1; i < n; i++) if (fft.magnitude[i] > fft.magnitude[peakBin]) peakBin = i;
check("FFT peak at bin 4 (cosine signal)", peakBin === 4, `peakBin=${peakBin}`);

// 10. computeFFT — empty input
check("FFT empty input returns empty arrays", computeFFT(new Float32Array(0)).magnitude.length === 0);

// 11. computeFFT — DC signal peaks at bin 0
const dc = new Float32Array(64).fill(0.5);
const fftDc = computeFFT(dc);
let dcPeak = 0;
for (let i = 0; i < 64; i++) if (fftDc.magnitude[i] > fftDc.magnitude[dcPeak]) dcPeak = i;
check("FFT DC signal peaks at bin 0", dcPeak === 0, `dcPeak=${dcPeak}`);

// 12. checkLivenessPro — too few frames returns graceful failure with v2 fields present
const tooFew = await checkLivenessPro([], []);
check("liveness insufficient frames handled", tooFew.totalScore === 0 && !tooFew.isLive);
check("liveness v2 padScore field present", typeof tooFew.padScore === "number");
check("liveness v2 blinkDetected field present", typeof tooFew.blinkDetected === "boolean");
check("liveness v2 opticalFlowConsistency field present", typeof tooFew.opticalFlowConsistency === "number");
check("liveness v2 lbpTextureScore field present", typeof tooFew.lbpTextureScore === "number");
check("liveness v2 fftMoireScore field present", typeof tooFew.fftMoireScore === "number");
check("liveness v2 colorDistortionScore field present", typeof tooFew.colorDistortionScore === "number");
check("liveness v2 depthDisparityScore field present", typeof tooFew.depthDisparityScore === "number");
check("liveness v2 specularHighlightScore field present", typeof tooFew.specularHighlightScore === "number");
check("liveness v2 blinkConfidence field present", typeof tooFew.blinkConfidence === "number");

// 13. invalid frames returns graceful failure
const invalid = await checkLivenessPro(["data:image/jpeg;base64,xxx", "data:image/jpeg;base64,yyy", "data:image/jpeg;base64,zzz"], ["turn_left"]);
check("liveness invalid frames handled", invalid.totalScore === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
