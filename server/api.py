# ============================================================
# Stable Diffusion WebUI - API Wrapper (Python / FastAPI)
# ============================================================
# Install: pip install fastapi uvicorn httpx python-dotenv
# Run:     uvicorn sd_api:app --host 0.0.0.0 --port 3000 --reload
# ============================================================

import os
import json
from typing import Optional
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SD WebUI API Wrapper", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ───────────────────────────────────────────────────
SD_HOST = os.getenv("SD_HOST", "http://localhost:7860")
API_KEY = os.getenv("API_KEY", "change-me-secret")
TIMEOUT = 120.0

# ── Auth ─────────────────────────────────────────────────────
def verify_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ── Schemas ───────────────────────────────────────────────────
class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = "blurry, low quality, deformed, ugly, bad anatomy"
    width: int = 512
    height: int = 768
    steps: int = 30
    cfg_scale: float = 7.0
    sampler_name: str = "DPM++ 2M Karras"
    seed: int = -1
    batch_size: int = 1
    restore_faces: bool = False

class Img2ImgRequest(BaseModel):
    prompt: str
    init_image: str  # base64
    negative_prompt: str = "blurry, low quality, deformed"
    denoising_strength: float = 0.75
    width: int = 512
    height: int = 768
    steps: int = 30
    cfg_scale: float = 7.0
    sampler_name: str = "DPM++ 2M Karras"
    seed: int = -1

class UpscaleRequest(BaseModel):
    image: str  # base64
    upscaling_resize: float = 2.0
    upscaler_1: str = "R-ESRGAN 4x+"

class SwitchModelRequest(BaseModel):
    model_name: str

# ── Health ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    async with httpx.AsyncClient() as client:
        try:
            await client.get(f"{SD_HOST}/sdapi/v1/progress", timeout=5)
            return {"status": "ok", "sd_host": SD_HOST}
        except Exception:
            raise HTTPException(503, detail="SD WebUI offline")

# ── Models ────────────────────────────────────────────────────
@app.get("/models", dependencies=[Depends(verify_key)])
async def list_models():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{SD_HOST}/sdapi/v1/sd-models")
        return [{"title": m["title"], "model_name": m["model_name"]} for m in r.json()]

@app.post("/models/switch", dependencies=[Depends(verify_key)])
async def switch_model(body: SwitchModelRequest):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{SD_HOST}/sdapi/v1/options",
            json={"sd_model_checkpoint": body.model_name},
            timeout=30,
        )
    return {"success": True, "active_model": body.model_name}

class InpaintRequest(BaseModel):
    prompt: str
    negative_prompt: str = "blurry, low quality, deformed"
    init_images: list
    mask: str
    mask_blur: int = 4
    inpainting_fill: int = 1
    inpaint_full_res: bool = True
    inpaint_full_res_padding: int = 32
    inpainting_mask_invert: int = 0
    denoising_strength: float = 0.75
    steps: int = 28
    cfg_scale: float = 7.0
    sampler_name: str = "DPM++ 2M Karras"
    seed: int = -1
    width: Optional[int] = None
    height: Optional[int] = None

@app.post("/inpaint", dependencies=[Depends(verify_key)])
async def inpaint(body: InpaintRequest):
    payload = body.dict(exclude_none=True)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{SD_HOST}/sdapi/v1/img2img", json=payload)
        data = r.json()
    info = json.loads(data["info"])
    return {"images": data["images"], "seed": info.get("seed"), "parameters": info}

# ── Txt2Img ───────────────────────────────────────────────────
@app.post("/generate/txt2img", dependencies=[Depends(verify_key)])
async def txt2img(body: Txt2ImgRequest):
    payload = body.dict()
    payload["save_images"] = True

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{SD_HOST}/sdapi/v1/txt2img", json=payload)
        data = r.json()

    info = json.loads(data["info"])
    return {
        "images": data["images"],   # list of base64 PNG strings
        "seed": info.get("seed"),
        "parameters": info,
    }

# ── Img2Img ───────────────────────────────────────────────────
@app.post("/generate/img2img", dependencies=[Depends(verify_key)])
async def img2img(body: Img2ImgRequest):
    payload = body.dict()
    payload["init_images"] = [payload.pop("init_image")]

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{SD_HOST}/sdapi/v1/img2img", json=payload)
        data = r.json()

    info = json.loads(data["info"])
    return {
        "images": data["images"],
        "seed": info.get("seed"),
        "parameters": info,
    }

# ── Progress ──────────────────────────────────────────────────
@app.get("/progress", dependencies=[Depends(verify_key)])
async def progress():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{SD_HOST}/sdapi/v1/progress")
        d = r.json()
    return {
        "progress": round(d["progress"] * 100),
        "eta_seconds": d["eta_relative"],
        "state": d["state"],
    }

# ── Interrupt ─────────────────────────────────────────────────
@app.post("/interrupt", dependencies=[Depends(verify_key)])
async def interrupt():
    async with httpx.AsyncClient() as client:
        await client.post(f"{SD_HOST}/sdapi/v1/interrupt")
    return {"success": True}

# ── Samplers ──────────────────────────────────────────────────
@app.get("/samplers", dependencies=[Depends(verify_key)])
async def samplers():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{SD_HOST}/sdapi/v1/samplers")
    return [s["name"] for s in r.json()]

# ── Upscale ───────────────────────────────────────────────────
@app.post("/upscale", dependencies=[Depends(verify_key)])
async def upscale(body: UpscaleRequest):
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{SD_HOST}/sdapi/v1/extra-single-image",
            json=body.dict(),
        )
    return {"image": r.json()["image"]}
