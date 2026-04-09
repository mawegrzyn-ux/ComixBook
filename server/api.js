// ============================================================
// Stable Diffusion WebUI — API Wrapper  v3
// ============================================================
// npm install express axios cors dotenv uuid express-rate-limit
// node sd-api.js
// ============================================================

// ── All imports at the top (ES module — no mid-file imports) ─
import express          from "express";
import axios            from "axios";
import cors             from "cors";
import dotenv           from "dotenv";
import rateLimit        from "express-rate-limit";
import { spawn }        from "child_process";
import { randomUUID }   from "crypto";
import {
  mkdirSync, writeFileSync, existsSync,
  copyFileSync, readFileSync, unlinkSync,
  readdirSync, statSync, createReadStream,
} from "fs";
import { join, extname } from "path";

dotenv.config();

// ── Config ───────────────────────────────────────────────────
const SD_HOST       = process.env.SD_HOST       || "http://localhost:7860";
const API_KEY       = process.env.API_KEY        || "change-me-secret";
const PORT          = parseInt(process.env.PORT  || "3000");
const KOHYA_DIR     = process.env.KOHYA_DIR      || "/workspace/kohya_ss";
const WEBUI_DIR     = process.env.WEBUI_DIR      || "/workspace/stable-diffusion-webui";
const GALLERY_DIR   = process.env.GALLERY_DIR    || "/workspace/gallery";
const IDLE_MINUTES  = parseInt(process.env.IDLE_MINUTES || "30");
const RUNPOD_KEY    = process.env.RUNPOD_API_KEY || "";
const POD_ID        = process.env.RUNPOD_POD_ID  || "";

// ── App setup ─────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "200mb" }));   // large because images are base64
app.use(cors({ origin: "*" }));              // lock down in production

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60_000,          // 1 minute window
  max: 60,                   // 60 requests / min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — slow down" },
  skip: (req) => req.headers["x-api-key"] === API_KEY,  // trusted clients skip
});
app.use(limiter);

// ── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Input sanitiser (strip null bytes, limit prompt length) ──
function sanitizePrompt(str) {
  if (typeof str !== "string") return "";
  return str.replace(/\0/g, "").slice(0, 2000);
}

// ══════════════════════════════════════════════════════════════
//  GENERATION QUEUE
//  All gen requests go through the queue — only one runs at a
//  time so two users don't fight over the GPU.
// ══════════════════════════════════════════════════════════════
const GEN_JOBS = new Map();   // jobId → job object
const GEN_QUEUE = [];         // pending job ids
let GPU_BUSY = false;

async function processQueue() {
  if (GPU_BUSY || GEN_QUEUE.length === 0) return;
  GPU_BUSY = true;
  const jobId = GEN_QUEUE.shift();
  const job = GEN_JOBS.get(jobId);
  if (!job) { GPU_BUSY = false; processQueue(); return; }

  job.status = "running";
  job.startedAt = Date.now();
  idleReset();

  try {
    const { data } = await axios.post(
      `${SD_HOST}/sdapi/v1/${job.endpoint}`,
      job.payload,
      { timeout: 180_000 }
    );
    const info = JSON.parse(data.info || "{}");
    job.status = "done";
    job.result = { images: data.images, seed: info.seed, parameters: info };
    // auto-save to gallery if images present
    if (data.images?.length) {
      autoSaveGallery(data.images, {
        prompt:          job.payload.prompt,
        negative_prompt: job.payload.negative_prompt,
        seed:            info.seed,
        model:           info.sd_model_name || "",
        width:           job.payload.width,
        height:          job.payload.height,
        tags:            [],
      });
    }
  } catch (err) {
    job.status = "error";
    job.error  = err.message;
  } finally {
    job.finishedAt = Date.now();
    GPU_BUSY = false;
    idleReset();
    processQueue();
  }
}

function enqueue(endpoint, payload) {
  const jobId = randomUUID().slice(0, 8);
  const position = GEN_QUEUE.length + (GPU_BUSY ? 1 : 0);
  GEN_JOBS.set(jobId, {
    id: jobId, endpoint, payload,
    status: "queued", position,
    queuedAt: Date.now(), startedAt: null, finishedAt: null,
    result: null, error: null,
  });
  GEN_QUEUE.push(jobId);
  setImmediate(processQueue);
  return { job_id: jobId, position, queue_length: GEN_QUEUE.length };
}

// ══════════════════════════════════════════════════════════════
//  IDLE AUTO-SHUTDOWN
// ══════════════════════════════════════════════════════════════
let lastActivity = Date.now();

function idleReset() { lastActivity = Date.now(); }

async function shutdownPod() {
  if (!RUNPOD_KEY || !POD_ID) {
    console.warn("[idle] RUNPOD_API_KEY / RUNPOD_POD_ID not set — skipping shutdown");
    return;
  }
  console.log(`[idle] shutting down pod ${POD_ID}…`);
  try {
    await axios.post(
      "https://api.runpod.io/graphql",
      { query: `mutation { podStop(input: { podId: "${POD_ID}" }) { id } }` },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_KEY}` } }
    );
  } catch (err) {
    console.error("[idle] shutdown failed:", err.message);
  }
}

if (IDLE_MINUTES > 0) {
  setInterval(() => {
    const idleMs  = Date.now() - lastActivity;
    const idleMins = idleMs / 60_000;
    console.log(`[idle] inactive ${idleMins.toFixed(1)}/${IDLE_MINUTES} min`);
    if (idleMs >= IDLE_MINUTES * 60_000) shutdownPod();
  }, 60_000);
  console.log(`[idle] auto-shutdown active — ${IDLE_MINUTES} min`);
}

// ══════════════════════════════════════════════════════════════
//  GALLERY  (flat-file JSON store on network volume)
// ══════════════════════════════════════════════════════════════
const GAL_INDEX = join(GALLERY_DIR, "index.json");

function galLoad() {
  try { return JSON.parse(readFileSync(GAL_INDEX, "utf8")); }
  catch { return []; }
}

function galSave(items) {
  mkdirSync(GALLERY_DIR, { recursive: true });
  writeFileSync(GAL_INDEX, JSON.stringify(items, null, 2));
}

function autoSaveGallery(images, meta) {
  try {
    const items = galLoad();
    images.forEach((b64) => {
      const id = randomUUID().slice(0, 12);
      const filepath = join(GALLERY_DIR, `${id}.png`);
      writeFileSync(filepath, Buffer.from(b64, "base64"));
      items.unshift({ id, filepath, ...meta, tags: meta.tags || [], savedAt: Date.now() });
    });
    // keep max 2000 images
    if (items.length > 2000) items.splice(2000);
    galSave(items);
  } catch (err) {
    console.warn("[gallery] auto-save failed:", err.message);
  }
}

// ══════════════════════════════════════════════════════════════
//  TRAINING JOBS
// ══════════════════════════════════════════════════════════════
const TRAIN_JOBS = new Map();  // jobId → { status, progress, epoch, step, loss, eta, log, proc, output_path, error }

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

// ── Health ────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await axios.get(`${SD_HOST}/sdapi/v1/progress`, { timeout: 5000 });
    const idleMs = Date.now() - lastActivity;
    res.json({
      status:           "ok",
      sd_host:          SD_HOST,
      queue_length:     GEN_QUEUE.length,
      gpu_busy:         GPU_BUSY,
      idle_minutes:     IDLE_MINUTES,
      idle_elapsed_min: Math.round(idleMs / 60_000),
      shutdown_enabled: IDLE_MINUTES > 0 && !!RUNPOD_KEY && !!POD_ID,
    });
  } catch {
    res.status(503).json({ status: "sd_offline" });
  }
});

// ── Models ────────────────────────────────────────────────────
app.get("/models", auth, async (req, res) => {
  try {
    const { data } = await axios.get(`${SD_HOST}/sdapi/v1/sd-models`);
    res.json(data.map((m) => ({ title: m.title, model_name: m.model_name })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/models/switch", auth, async (req, res) => {
  const { model_name } = req.body;
  if (!model_name) return res.status(400).json({ error: "model_name required" });
  try {
    await axios.post(`${SD_HOST}/sdapi/v1/options`, { sd_model_checkpoint: model_name });
    res.json({ success: true, active_model: model_name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Samplers ──────────────────────────────────────────────────
app.get("/samplers", auth, async (req, res) => {
  try {
    const { data } = await axios.get(`${SD_HOST}/sdapi/v1/samplers`);
    res.json(data.map((s) => s.name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Progress ──────────────────────────────────────────────────
app.get("/progress", auth, async (req, res) => {
  try {
    const { data } = await axios.get(`${SD_HOST}/sdapi/v1/progress`);
    res.json({ progress: Math.round(data.progress * 100), eta_seconds: data.eta_relative, state: data.state });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Interrupt ─────────────────────────────────────────────────
app.post("/interrupt", auth, async (req, res) => {
  try { await axios.post(`${SD_HOST}/sdapi/v1/interrupt`); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Upscale ───────────────────────────────────────────────────
app.post("/upscale", auth, async (req, res) => {
  const { image, upscaling_resize = 2, upscaler_1 = "R-ESRGAN 4x+" } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });
  try {
    const { data } = await axios.post(`${SD_HOST}/sdapi/v1/extra-single-image`,
      { image, upscaling_resize, upscaler_1 }, { timeout: 60_000 });
    res.json({ image: data.image });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Caption (CLIP interrogate) ────────────────────────────────
app.post("/caption", auth, async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });
  try {
    const { data } = await axios.post(`${SD_HOST}/sdapi/v1/interrogate`,
      { image, model: "clip" }, { timeout: 30_000 });
    res.json({ caption: data.caption || "" });
  } catch { res.json({ caption: "" }); }
});

// ── Txt2Img (queued) ──────────────────────────────────────────
app.post("/generate/txt2img", auth, async (req, res) => {
  const {
    prompt = "", negative_prompt = "", width = 512, height = 768,
    steps = 28, cfg_scale = 7, sampler_name = "DPM++ 2M Karras",
    seed = -1, batch_size = 1, restore_faces = false,
    alwayson_scripts, save_to_gallery = true,
  } = req.body;

  const payload = {
    prompt: sanitizePrompt(prompt),
    negative_prompt: sanitizePrompt(negative_prompt),
    width, height, steps, cfg_scale, sampler_name,
    seed, batch_size, restore_faces, save_images: true,
    ...(alwayson_scripts && { alwayson_scripts }),
  };

  // Async mode: client polls /queue/:jobId
  if (req.headers["x-async"] === "true") {
    return res.json(enqueue("txt2img", payload));
  }

  // Blocking mode (default): wait for result
  const { job_id } = enqueue("txt2img", payload);
  const result = await waitForJob(job_id, 180_000);
  if (result.error) return res.status(500).json({ error: result.error });
  res.json(result.result);
});

// ── Img2Img (queued) ──────────────────────────────────────────
app.post("/generate/img2img", auth, async (req, res) => {
  const {
    prompt = "", negative_prompt = "", init_image, init_images,
    denoising_strength = 0.75, width = 512, height = 768,
    steps = 28, cfg_scale = 7, sampler_name = "DPM++ 2M Karras",
    seed = -1, alwayson_scripts,
  } = req.body;

  const initImgs = init_images || (init_image ? [init_image] : null);
  if (!initImgs?.[0]) return res.status(400).json({ error: "init_image required" });

  const payload = {
    prompt: sanitizePrompt(prompt),
    negative_prompt: sanitizePrompt(negative_prompt),
    init_images: initImgs, denoising_strength,
    width, height, steps, cfg_scale, sampler_name, seed,
    ...(alwayson_scripts && { alwayson_scripts }),
  };

  if (req.headers["x-async"] === "true") return res.json(enqueue("img2img", payload));

  const { job_id } = enqueue("img2img", payload);
  const result = await waitForJob(job_id, 180_000);
  if (result.error) return res.status(500).json({ error: result.error });
  res.json(result.result);
});

// ── Inpaint ───────────────────────────────────────────────────
app.post("/inpaint", auth, async (req, res) => {
  const {
    init_images, mask,
    prompt = "", negative_prompt = "blurry, low quality, deformed",
    denoising_strength = 0.75, mask_blur = 4,
    inpainting_fill = 1, inpaint_full_res = true,
    inpaint_full_res_padding = 32, inpainting_mask_invert = 0,
    steps = 28, cfg_scale = 7, sampler_name = "DPM++ 2M Karras",
    seed = -1, width, height, alwayson_scripts,
  } = req.body;

  if (!init_images?.[0]) return res.status(400).json({ error: "init_images required" });
  if (!mask)             return res.status(400).json({ error: "mask required" });

  const payload = {
    prompt: sanitizePrompt(prompt), negative_prompt: sanitizePrompt(negative_prompt),
    init_images, mask, denoising_strength, mask_blur,
    inpainting_fill, inpaint_full_res, inpaint_full_res_padding,
    inpainting_mask_invert, steps, cfg_scale, sampler_name, seed,
    ...(width  && { width }),
    ...(height && { height }),
    ...(alwayson_scripts && { alwayson_scripts }),
  };

  try {
    const { data } = await axios.post(`${SD_HOST}/sdapi/v1/img2img`, payload, { timeout: 180_000 });
    const info = JSON.parse(data.info || "{}");
    res.json({ images: data.images, seed: info.seed, parameters: info });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Queue status ──────────────────────────────────────────────
app.get("/queue", auth, (req, res) => {
  res.json({
    busy:         GPU_BUSY,
    queued:       GEN_QUEUE.length,
    jobs: GEN_QUEUE.map((id) => {
      const j = GEN_JOBS.get(id);
      return { id, status: j?.status, queued_ago: j?.queuedAt ? Math.round((Date.now()-j.queuedAt)/1000) : null };
    }),
  });
});

app.get("/queue/:jobId", auth, (req, res) => {
  const job = GEN_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const pos = GEN_QUEUE.indexOf(req.params.jobId);
  res.json({
    id: job.id, status: job.status, position: pos,
    result: job.status === "done" ? job.result : null,
    error:  job.error || null,
    started_ago:  job.startedAt  ? Math.round((Date.now()-job.startedAt)/1000)  : null,
    finished_ago: job.finishedAt ? Math.round((Date.now()-job.finishedAt)/1000) : null,
  });
});

app.post("/queue/:jobId/cancel", auth, (req, res) => {
  const qi = GEN_QUEUE.indexOf(req.params.jobId);
  if (qi >= 0) GEN_QUEUE.splice(qi, 1);
  const job = GEN_JOBS.get(req.params.jobId);
  if (job) job.status = "cancelled";
  res.json({ success: true });
});

// Helper: wait for a queued job to finish
function waitForJob(jobId, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const job = GEN_JOBS.get(jobId);
      if (!job || Date.now() > deadline) {
        clearInterval(poll);
        resolve({ error: "timeout or job missing" });
        return;
      }
      if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
        clearInterval(poll);
        resolve(job);
      }
    }, 500);
  });
}

// ── Idle status ───────────────────────────────────────────────
app.get("/idle", auth, (req, res) => {
  const idleMs = Date.now() - lastActivity;
  res.json({
    idle_minutes:     IDLE_MINUTES,
    elapsed_minutes:  Math.round(idleMs / 60_000),
    remaining_minutes: Math.max(0, IDLE_MINUTES - idleMs / 60_000),
    shutdown_enabled: IDLE_MINUTES > 0 && !!RUNPOD_KEY && !!POD_ID,
    warning: IDLE_MINUTES > 0 && idleMs > IDLE_MINUTES * 0.75 * 60_000,
  });
});

// ── Gallery ───────────────────────────────────────────────────
app.post("/gallery/save", auth, (req, res) => {
  const { images } = req.body;
  if (!images?.length) return res.status(400).json({ error: "images array required" });
  try {
    const items = galLoad();
    const saved = [];
    images.forEach(({ b64, prompt = "", negative_prompt = "", seed, model = "", width, height, tags = [] }) => {
      if (!b64) return;
      const id = randomUUID().slice(0, 12);
      const filepath = join(GALLERY_DIR, `${id}.png`);
      mkdirSync(GALLERY_DIR, { recursive: true });
      writeFileSync(filepath, Buffer.from(b64, "base64"));
      const item = { id, filepath, prompt, negative_prompt, seed, model, width, height, tags, savedAt: Date.now() };
      items.unshift(item);
      saved.push({ id, seed });
    });
    if (items.length > 2000) items.splice(2000);
    galSave(items);
    res.json({ saved: saved.length, ids: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/gallery", auth, (req, res) => {
  try {
    let items = galLoad();
    const { tag, search, model, limit = "100", offset = "0" } = req.query;
    if (tag)    items = items.filter(i => (i.tags || []).includes(tag));
    if (model)  items = items.filter(i => i.model === model);
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(i => (i.prompt || "").toLowerCase().includes(s));
    }
    const total = items.length;
    const page  = items.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    // derive tag counts from full filtered set
    const tagMap = {};
    items.forEach(i => (i.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
    const tags = Object.entries(tagMap).map(([tag, count]) => ({ tag, count })).sort((a,b)=>b.count-a.count);
    res.json({ total, items: page.map(i => ({ ...i, filepath: undefined })), tags });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve image file — key can be header OR query param (for <img src> tags)
app.get("/gallery/:id/image", (req, res) => {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  try {
    const items = galLoad();
    const item  = items.find(i => i.id === req.params.id);
    if (!item || !existsSync(item.filepath)) return res.status(404).json({ error: "not found" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(item.filepath).pipe(res);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/gallery/:id", auth, (req, res) => {
  try {
    const items = galLoad();
    const item  = items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    const { tags, prompt } = req.body;
    if (tags   !== undefined) item.tags   = tags;
    if (prompt !== undefined) item.prompt = prompt;
    galSave(items);
    res.json({ success: true, item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/gallery/:id", auth, (req, res) => {
  try {
    let items = galLoad();
    const item = items.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not found" });
    try { unlinkSync(item.filepath); } catch {}
    items = items.filter(i => i.id !== req.params.id);
    galSave(items);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/gallery/tags", auth, (req, res) => {
  try {
    const items = galLoad();
    const tagMap = {};
    items.forEach(i => (i.tags || []).forEach(t => { tagMap[t] = (tagMap[t] || 0) + 1; }));
    res.json(Object.entries(tagMap).map(([tag, count]) => ({ tag, count })).sort((a,b)=>b.count-a.count));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LoRA Training ─────────────────────────────────────────────
app.post("/train/lora", auth, async (req, res) => {
  const {
    name, base_model, images,
    rank = 32, epochs = 20, learning_rate = "1e-4", batch_size = 2,
  } = req.body;

  if (!name)         return res.status(400).json({ error: "name required" });
  if (!images?.length) return res.status(400).json({ error: "images required" });

  const jobId    = randomUUID().slice(0, 8);
  const trainDir = `/tmp/lora_${jobId}`;
  const imgDir   = `${trainDir}/img/${epochs}_${name}`;
  const logDir   = `${trainDir}/logs`;
  const outDir   = `${trainDir}/output`;
  const outPath  = join(WEBUI_DIR, "models", "Lora", `${name}.safetensors`);

  mkdirSync(imgDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  images.forEach((img, i) => {
    writeFileSync(join(imgDir, `${String(i).padStart(4,"0")}.png`), Buffer.from(img.b64, "base64"));
    writeFileSync(join(imgDir, `${String(i).padStart(4,"0")}.txt`), img.caption || name);
  });

  const toml = [
    `[general]`,
    `pretrained_model_name_or_path = "${join(WEBUI_DIR,"models","Stable-diffusion",base_model)}"`,
    `train_data_dir   = "${trainDir}/img"`,
    `output_dir       = "${outDir}"`,
    `logging_dir      = "${logDir}"`,
    `output_name      = "${name}"`,
    `save_model_as    = "safetensors"`,
    `network_module   = "networks.lora"`,
    `network_dim      = ${rank}`,
    `network_alpha    = ${Math.floor(rank / 2)}`,
    `learning_rate    = "${learning_rate}"`,
    `unet_lr          = "${learning_rate}"`,
    `text_encoder_lr  = "1e-5"`,
    `lr_scheduler     = "cosine_with_restarts"`,
    `lr_warmup_steps  = 100`,
    `max_train_epochs = ${epochs}`,
    `train_batch_size = ${batch_size}`,
    `save_every_n_epochs = ${Math.max(1, Math.floor(epochs / 4))}`,
    `mixed_precision  = "fp16"`,
    `save_precision   = "fp16"`,
    `seed             = 42`,
    `cache_latents    = true`,
    `gradient_checkpointing = true`,
    `caption_extension = ".txt"`,
    `shuffle_caption  = true`,
    `flip_aug         = true`,
    `resolution       = "512,768"`,
    `enable_bucket    = true`,
    `min_bucket_reso  = 256`,
    `max_bucket_reso  = 1024`,
    `bucket_reso_steps = 64`,
  ].join("\n");

  const configPath = `${trainDir}/config.toml`;
  writeFileSync(configPath, toml);

  TRAIN_JOBS.set(jobId, {
    status: "starting", progress: 0, epoch: 0, step: 0,
    loss: null, eta: null, log: "",
    output_path: outPath, proc: null, error: null,
  });

  const proc = spawn("python3", [`${KOHYA_DIR}/train_network.py`, "--config_file", configPath], {
    cwd: KOHYA_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const job = TRAIN_JOBS.get(jobId);
  job.proc   = proc;
  job.status = "running";

  const parseLine = (line) => {
    job.log += line;
    const eM = line.match(/epoch (\d+)\/(\d+)/i);
    if (eM) { job.epoch = parseInt(eM[1]); job.progress = Math.round((job.epoch / epochs) * 100); }
    const sM = line.match(/steps?: (\d+)/i);
    if (sM) job.step = parseInt(sM[1]);
    const lM = line.match(/loss[=:\s]+([\d.]+)/i);
    if (lM) job.loss = parseFloat(lM[1]).toFixed(4);
    const etaM = line.match(/eta[=:\s]+([0-9:]+)/i);
    if (etaM) job.eta = etaM[1];
  };

  proc.stdout.on("data", (c) => parseLine(c.toString()));
  proc.stderr.on("data", (c) => parseLine(c.toString()));

  proc.on("close", (code) => {
    if (code === 0) {
      const finalOut = join(outDir, `${name}.safetensors`);
      if (existsSync(finalOut)) {
        mkdirSync(join(WEBUI_DIR, "models", "Lora"), { recursive: true });
        copyFileSync(finalOut, outPath);
        job.status      = "done";
        job.progress    = 100;
        job.output_path = outPath;
        job.log        += `\n✓ Saved to ${outPath}\n`;
      } else {
        job.status = "error";
        job.error  = "output file not found after training";
      }
    } else {
      job.status = "error";
      job.error  = `Process exited with code ${code}`;
    }
  });

  res.json({ job_id: jobId, status: "started" });
});

app.get("/train/status/:jobId", auth, (req, res) => {
  const job = TRAIN_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const logLines = job.log.split("\n").filter(Boolean).slice(-4).join("\n");
  res.json({
    status: job.status, progress: job.progress,
    epoch: job.epoch,   step: job.step,
    loss: job.loss,     eta: job.eta,
    log: logLines,      output_path: job.output_path,
    error: job.error,
  });
});

app.post("/train/cancel/:jobId", auth, (req, res) => {
  const job = TRAIN_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "not found" });
  if (job.proc) { job.proc.kill("SIGTERM"); setTimeout(() => job.proc?.kill("SIGKILL"), 3000); }
  job.status = "cancelled";
  res.json({ success: true });
});

// Download trained LoRA — key accepted as query param for direct browser links
app.get("/train/download/:jobId", (req, res) => {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });
  const job = TRAIN_JOBS.get(req.params.jobId);
  if (!job)               return res.status(404).json({ error: "job not found" });
  if (job.status !== "done") return res.status(400).json({ error: "training not complete" });
  const fp = job.output_path;
  if (!existsSync(fp))    return res.status(404).json({ error: "file not on disk" });
  res.setHeader("Content-Disposition", `attachment; filename="${fp.split("/").pop()}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  createReadStream(fp).pipe(res);
});

// ── LoRA test generation (4 images after training) ────────────
app.post("/train/test/:jobId", auth, async (req, res) => {
  const job = TRAIN_JOBS.get(req.params.jobId);
  if (!job || job.status !== "done") return res.status(400).json({ error: "training not complete" });

  const loraName = job.output_path.split("/").pop().replace(".safetensors", "");
  const { weight = 0.7, char_desc = "a person" } = req.body;

  const testPrompts = [
    `${char_desc}, <lora:${loraName}:${weight}>, photorealistic, close-up portrait, studio lighting`,
    `${char_desc}, <lora:${loraName}:${weight}>, photorealistic, three-quarter view, golden hour`,
    `${char_desc}, <lora:${loraName}:${weight}>, photorealistic, full body shot, neutral background`,
    `${char_desc}, <lora:${loraName}:${weight}>, photorealistic, side profile, cinematic lighting`,
  ];

  const results = [];
  for (const prompt of testPrompts) {
    try {
      const { data } = await axios.post(`${SD_HOST}/sdapi/v1/txt2img`, {
        prompt, negative_prompt: "blurry, low quality, deformed, bad anatomy",
        width: 512, height: 768, steps: 25, cfg_scale: 7,
        sampler_name: "DPM++ 2M Karras", seed: -1, batch_size: 1,
      }, { timeout: 120_000 });
      const info = JSON.parse(data.info || "{}");
      results.push({ image: data.images[0], seed: info.seed, prompt });
    } catch (err) {
      results.push({ image: null, error: err.message, prompt });
    }
  }

  idleReset();
  res.json({ lora: loraName, weight, results });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  SD API Wrapper running on port ${PORT}`);
  console.log(`   SD WebUI:   ${SD_HOST}`);
  console.log(`   Gallery:    ${GALLERY_DIR}`);
  console.log(`   Kohya:      ${KOHYA_DIR}`);
  console.log(`   Idle limit: ${IDLE_MINUTES > 0 ? IDLE_MINUTES + " min" : "disabled"}`);
  console.log(`   Queue:      enabled\n`);
  mkdirSync(GALLERY_DIR, { recursive: true });
});
