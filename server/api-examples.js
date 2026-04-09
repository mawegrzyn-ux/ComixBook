// ============================================================
// SD API Wrapper - Usage Examples
// ============================================================
// Works with both the Node.js and Python versions of the wrapper

const API_BASE = "http://localhost:3000"; // your wrapper URL
const API_KEY = "change-me-secret";

const headers = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
};

// ── Helper ────────────────────────────────────────────────────
async function sdFetch(path, method = "GET", body = null) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── 1. Health check ───────────────────────────────────────────
async function checkHealth() {
  const data = await fetch(`${API_BASE}/health`).then((r) => r.json());
  console.log("Health:", data);
}

// ── 2. Generate image (txt2img) ───────────────────────────────
async function generateImage(prompt, options = {}) {
  const data = await sdFetch("/generate/txt2img", "POST", {
    prompt,
    negative_prompt: options.negative_prompt ?? "blurry, low quality, deformed",
    width: options.width ?? 512,
    height: options.height ?? 768,
    steps: options.steps ?? 30,
    cfg_scale: options.cfg_scale ?? 7,
    sampler_name: options.sampler ?? "DPM++ 2M Karras",
    seed: options.seed ?? -1,
    batch_size: options.batch_size ?? 1,
  });

  console.log(`Generated ${data.images.length} image(s), seed: ${data.seed}`);

  // Save to disk (Node.js)
  // import fs from "fs";
  // data.images.forEach((b64, i) => {
  //   fs.writeFileSync(`output_${i}.png`, Buffer.from(b64, "base64"));
  // });

  // Or use in browser <img> tag:
  // document.getElementById("result").src = `data:image/png;base64,${data.images[0]}`;

  return data;
}

// ── 3. Img2Img ────────────────────────────────────────────────
async function img2img(prompt, base64Image, denoising_strength = 0.6) {
  return sdFetch("/generate/img2img", "POST", {
    prompt,
    init_image: base64Image,
    denoising_strength,
    steps: 30,
  });
}

// ── 4. Poll progress ──────────────────────────────────────────
async function pollProgress() {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const data = await sdFetch("/progress");
      console.log(`Progress: ${data.progress}% | ETA: ${Math.round(data.eta_seconds)}s`);
      if (data.progress >= 100 || data.progress === 0) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

// ── 5. List models ────────────────────────────────────────────
async function listModels() {
  const models = await sdFetch("/models");
  console.log("Available models:", models);
  return models;
}

// ── 6. Switch model ───────────────────────────────────────────
async function switchModel(modelName) {
  const data = await sdFetch("/models/switch", "POST", { model_name: modelName });
  console.log("Switched to:", data.active_model);
}

// ── 7. Upscale ────────────────────────────────────────────────
async function upscale(base64Image, scale = 2) {
  const data = await sdFetch("/upscale", "POST", {
    image: base64Image,
    upscaling_resize: scale,
    upscaler_1: "R-ESRGAN 4x+",
  });
  return data.image; // base64 upscaled image
}

// ── Example workflow ──────────────────────────────────────────
async function main() {
  await checkHealth();

  // Start generation
  const genPromise = generateImage("a beautiful sunset over the ocean, masterpiece, detailed", {
    width: 512,
    height: 768,
    steps: 30,
  });

  // Poll progress in parallel
  await pollProgress();

  // Get result
  const result = await genPromise;
  console.log("Done! Seed:", result.seed);

  // Optional: upscale result
  const upscaled = await upscale(result.images[0], 2);
  console.log("Upscaled image ready.");
}

main().catch(console.error);

// ── .env template ─────────────────────────────────────────────
/*
SD_HOST=https://<YOUR_POD_ID>-7860.proxy.runpod.net
API_KEY=your-strong-secret-key-here
PORT=3000
*/
