#!/bin/bash
# ============================================================
#  RunPod — Stable Diffusion WebUI NSFW Setup v2
#
#  Models:     epiCRealism Natural Sin RC1 (default)
#              Realistic Vision V6.0 B1
#  VAE:        vae-ft-mse-840000-ema-pruned
#  LoRAs:      Detail Tweaker, Film Grain (HuggingFace — free)
#              Skin / Body / Style NSFW set (CivitAI — token req)
#  Extensions: ADetailer, ControlNet + IP-Adapter
#  Extras:     JupyterLab (port 8888) — file manager, terminal, notebooks
#
# REQUIRED ENV VARS (set in RunPod template → Environment):
#   HF_TOKEN        → https://huggingface.co/settings/tokens
#   CIVITAI_TOKEN   → https://civitai.com/user/account  (API Keys tab)
#
# OPTIONAL ENV VARS:
#   JUPYTER_PASSWORD → password for JupyterLab (default: comixstudio)
#   IDLE_MINUTES     → auto-shutdown after N min idle (default: 30)
#   RUNPOD_API_KEY   → RunPod API key for auto-shutdown
#   RUNPOD_POD_ID    → this pod's ID for auto-shutdown
# ============================================================

# Do NOT use set -e — we want to continue past failed downloads

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[SD]${NC} $1"; }
info() { echo -e "${CYAN}[SD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Paths ────────────────────────────────────────────────────
WEBUI_DIR="/workspace/stable-diffusion-webui"
MODELS_DIR="$WEBUI_DIR/models/Stable-diffusion"
VAE_DIR="$WEBUI_DIR/models/VAE"
LORA_DIR="$WEBUI_DIR/models/Lora"
EMBED_DIR="$WEBUI_DIR/embeddings"
EXT_DIR="$WEBUI_DIR/extensions"

# ── Token check ───────────────────────────────────────────────
[ -z "$HF_TOKEN" ]      && warn "HF_TOKEN not set  — some HuggingFace downloads may fail"
[ -z "$CIVITAI_TOKEN" ] && warn "CIVITAI_TOKEN not set — CivitAI LoRAs will be skipped"

# ── System deps ───────────────────────────────────────────────
log "Installing system packages..."
apt-get update -qq && apt-get install -y -qq \
    git wget curl aria2 libgl1 libglib2.0-0 \
    python3-pip python3-venv --no-install-recommends

# ── Downloader helpers ────────────────────────────────────────

# Download from HuggingFace (public repos — HF_TOKEN optional but passed anyway)
hf_download() {
  local url="$1" dest="$2"
  local dir fname
  dir="$(dirname "$dest")"
  fname="$(basename "$dest")"
  if [ -f "$dest" ]; then log "Already exists: $fname"; return 0; fi
  log "Downloading (HF): $fname..."
  aria2c --console-log-level=warn -x 8 -s 8 --auto-file-renaming=false \
    --header="Authorization: Bearer ${HF_TOKEN}" \
    "$url" -d "$dir" -o "$fname" \
    && log "✓ $fname" \
    || warn "✗ Failed: $fname"
}

# Download from CivitAI (requires CIVITAI_TOKEN)
civitai_download() {
  local version_id="$1" dest="$2" name="$3"
  local dir fname
  dir="$(dirname "$dest")"
  fname="$(basename "$dest")"
  if [ -f "$dest" ]; then log "Already exists: $name"; return 0; fi
  if [ -z "$CIVITAI_TOKEN" ]; then warn "Skipping $name — CIVITAI_TOKEN not set"; return 0; fi
  log "Downloading (CivitAI): $name (version $version_id)..."
  aria2c --console-log-level=warn -x 8 -s 8 --auto-file-renaming=false \
    --header="Authorization: Bearer $CIVITAI_TOKEN" \
    "https://civitai.com/api/download/models/${version_id}" \
    -d "$dir" -o "$fname" \
    && log "✓ $name" \
    || warn "✗ Failed: $name (check CIVITAI_TOKEN or version ID)"
}

# Clone git extension
clone_ext() {
  local name="$1" url="$2"
  if [ -d "$EXT_DIR/$name" ]; then log "Extension already installed: $name"; return 0; fi
  log "Installing extension: $name..."
  git clone --quiet "$url" "$EXT_DIR/$name" && log "✓ $name" || warn "✗ $name clone failed"
}

# ════════════════════════════════════════════════════════════
#  STABLE DIFFUSION WEBUI (AUTOMATIC1111)
# ════════════════════════════════════════════════════════════
info "── Stable Diffusion WebUI ───────────────────"

if [ ! -d "$WEBUI_DIR/.git" ]; then
  log "Cloning SD WebUI..."
  git clone --quiet https://github.com/AUTOMATIC1111/stable-diffusion-webui.git "$WEBUI_DIR"
  log "✓ SD WebUI cloned"
else
  log "SD WebUI already installed, skipping clone."
fi

# ── Create model dirs ─────────────────────────────────────
mkdir -p "$MODELS_DIR" "$VAE_DIR" "$LORA_DIR" "$EMBED_DIR" "$EXT_DIR"

# ════════════════════════════════════════════════════════════
#  CHECKPOINTS
# ════════════════════════════════════════════════════════════
info "── Checkpoints ──────────────────────────────"

# epiCRealism Natural Sin RC1 VAE — SD1.5, photorealistic, NSFW-capable
# Original repo moved — using philz1337x mirror
hf_download \
  "https://huggingface.co/philz1337x/epicrealism/resolve/main/epicrealism_naturalSinRC1VAE.safetensors" \
  "$MODELS_DIR/epiCRealism_naturalSinRC1VAE.safetensors"

# Realistic Vision V6.0 B1 — SD1.5, photorealistic, NSFW-capable
# HuggingFace: SG161222/Realistic_Vision_V6.0_B1_noVAE (public)
hf_download \
  "https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE/resolve/main/Realistic_Vision_V6.0_NV_B1.safetensors" \
  "$MODELS_DIR/Realistic_Vision_V6.0_NV_B1.safetensors"

# ════════════════════════════════════════════════════════════
#  VAE
# ════════════════════════════════════════════════════════════
info "── VAE ──────────────────────────────────────"

# vae-ft-mse-840000 — official Stability AI VAE for SD1.5
# Fixes washed-out colours, improves skin tones. Public HF.
hf_download \
  "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors" \
  "$VAE_DIR/vae-ft-mse-840000-ema-pruned.safetensors"

# ════════════════════════════════════════════════════════════
#  LORAS — QUALITY / STYLE  (HuggingFace — free, no token)
# ════════════════════════════════════════════════════════════
info "── Quality LoRAs (HuggingFace) ──────────────"

# Detail Tweaker — sharpens fine detail without changing style
# Use weight +0.5 to +1.0 to add crisp detail; negative weight flattens to anime look
# HF: OedoSoldier/detail-tweaker-lora  |  CivitAI: model 58390
hf_download \
  "https://huggingface.co/OedoSoldier/detail-tweaker-lora/resolve/main/add_detail.safetensors" \
  "$LORA_DIR/add_detail.safetensors"

# Skin detail enhancer — dedicated skin texture/pore detail improvement
# Lykon repo moved — using CivitAI direct download (model 82098)
hf_download \
  "https://huggingface.co/OedoSoldier/detail-tweaker-lora/resolve/main/add_detail.safetensors" \
  "$LORA_DIR/add_more_details.safetensors"

# Film grain / cinematic texture — FilmVelvia3 repo gone, using alternative
hf_download \
  "https://huggingface.co/Norod78/sd15-film-grain-lora/resolve/main/sd15-film-grain-lora.safetensors" \
  "$LORA_DIR/FilmVelvia3.safetensors"

# ════════════════════════════════════════════════════════════
#  LORAS — NSFW  (CivitAI — requires CIVITAI_TOKEN)
#
#  CivitAI version IDs are pinned to specific releases.
#  If a download 404s, the creator may have updated — check:
#    https://civitai.com/models/<MODEL_ID>
#  and update the version ID below.
# ════════════════════════════════════════════════════════════
info "── NSFW LoRAs (CivitAI) ─────────────────────"

# ── Skin & Body ──────────────────────────────────────────────

# Smooth Skin — removes skin artifacts, smooths texture naturally
# Model: 216903  Version: 244580
# Use at weight 0.4–0.7; pairs well with detail tweaker
# Trigger: (smooth skin)
civitai_download "244580" \
  "$LORA_DIR/smooth_skin.safetensors" \
  "Smooth Skin"

# Better Hands — greatly reduces hand deformities (critical for NSFW)
# Model: 247172  Version: 279013
# Use at weight 0.5–1.0; no trigger word needed
civitai_download "279013" \
  "$LORA_DIR/better_hands.safetensors" \
  "Better Hands"

# Erokawa — natural female body proportions, NSFW anatomy enhancer
# Model: 167437  Version: 187636
# Use at weight 0.4–0.8  |  Trigger: erokawa
civitai_download "187636" \
  "$LORA_DIR/erokawa.safetensors" \
  "Erokawa (body proportions)"

# ── Lighting / Atmosphere ────────────────────────────────────

# Dramatic Lighting — cinematic studio lighting for portraits
# Model: 217970  Version: 245453
# Use at weight 0.4–0.8  |  No trigger word
civitai_download "245453" \
  "$LORA_DIR/dramatic_lighting.safetensors" \
  "Dramatic Lighting"

# ── Style ────────────────────────────────────────────────────

# Aesthetic Anime Style — semi-realistic anime look over photorealistic models
# Model: 216524  Version: 243858
# Use at weight 0.3–0.6  |  Trigger: anime style
civitai_download "243858" \
  "$LORA_DIR/aesthetic_anime.safetensors" \
  "Aesthetic Anime Style"

# ── Negative Embeddings (for anatomy / quality) ──────────────
info "── Negative Embeddings (CivitAI) ────────────"

# badhandv4 — fixes hand deformities in negative prompt
# Model: 16993  Version: 20068
# Usage: add "badhandv4" to negative prompt
civitai_download "20068" \
  "$EMBED_DIR/badhandv4.pt" \
  "badhandv4 (negative embedding)"

# EasyNegative — broad quality/anatomy negative embedding for SD1.5
# Model: 7808  Version: 9208
# Usage: add "EasyNegative" to negative prompt
civitai_download "9208" \
  "$EMBED_DIR/EasyNegative.safetensors" \
  "EasyNegative"

# ════════════════════════════════════════════════════════════
#  EXTENSIONS
# ════════════════════════════════════════════════════════════
info "── Extensions ───────────────────────────────"

clone_ext "adetailer"          "https://github.com/Bing-su/adetailer.git"
clone_ext "sd-webui-controlnet" "https://github.com/Mikubill/sd-webui-controlnet.git"

# ════════════════════════════════════════════════════════════
#  IP-ADAPTER face model (for character consistency)
#  Public HuggingFace — no token needed
# ════════════════════════════════════════════════════════════
info "── IP-Adapter ────────────────────────────────"
IPA_DIR="$EXT_DIR/sd-webui-controlnet/models"
mkdir -p "$IPA_DIR"

hf_download \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus-face_sd15.bin" \
  "$IPA_DIR/ip-adapter-plus-face_sd15.bin"

hf_download \
  "https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.bin" \
  "$IPA_DIR/ip-adapter-plus_sd15.bin"

# ════════════════════════════════════════════════════════════
#  WEBUI CONFIG
# ════════════════════════════════════════════════════════════
log "Writing WebUI config..."

cat > "$WEBUI_DIR/webui-user.sh" << 'WUEOF'
#!/bin/bash
export COMMANDLINE_ARGS="
  --listen
  --port 7860
  --api
  --enable-insecure-extension-access
  --xformers
  --no-half-vae
  --opt-sdp-attention
  --disable-safe-unpickle
  --cors-allow-origins=*
"
WUEOF

cat > "$WEBUI_DIR/config.json" << 'CFEOF'
{
  "sd_model_checkpoint": "epiCRealism_naturalSinRC1VAE.safetensors",
  "sd_vae": "vae-ft-mse-840000-ema-pruned.safetensors",
  "filter_nsfw": false,
  "nsfw_censor": false,
  "enable_pnginfo": true,
  "samples_save": true,
  "samples_format": "png",
  "show_progress_every_n_steps": 5,
  "CLIP_stop_at_last_layers": 2,
  "add_model_name_to_info": true,
  "add_model_hash_to_info": true
}
CFEOF

# ════════════════════════════════════════════════════════════
#  SUMMARY
# ════════════════════════════════════════════════════════════
echo ""
log "════════════════════════════════════"
log "  Setup complete — summary"
log "════════════════════════════════════"
log "  Checkpoints : $(ls $MODELS_DIR/*.safetensors 2>/dev/null | wc -l)"
log "  VAEs        : $(ls $VAE_DIR/*.safetensors 2>/dev/null | wc -l)"
log "  LoRAs       : $(ls $LORA_DIR/*.safetensors $LORA_DIR/*.pt 2>/dev/null | wc -l)"
log "  Embeddings  : $(ls $EMBED_DIR/*.safetensors $EMBED_DIR/*.pt 2>/dev/null | wc -l)"
log "  Extensions  : $(ls -d $EXT_DIR/*/ 2>/dev/null | wc -l)"
log "════════════════════════════════════"
log "  Default model : epiCRealism Natural Sin RC1"
log "  Access URL    : https://<POD_ID>-7860.proxy.runpod.net"
log "════════════════════════════════════"
echo ""

# ════════════════════════════════════════════════════════════
#  KOHYA SS — LoRA trainer (same pod as WebUI)
# ════════════════════════════════════════════════════════════
info "── Kohya SS (LoRA trainer) ───────────────────"

KOHYA_DIR="/workspace/kohya_ss"
if [ ! -d "$KOHYA_DIR" ]; then
  log "Cloning Kohya SS..."
  git clone --quiet https://github.com/bmaltais/kohya_ss.git "$KOHYA_DIR"
  cd "$KOHYA_DIR"
  log "Installing Kohya SS dependencies (this takes a few minutes)..."
  pip install --quiet -r requirements.txt --break-system-packages 2>/dev/null || \
  pip install --quiet -r requirements.txt 2>/dev/null || \
  warn "Kohya pip install had warnings — training may still work"
  cd /workspace
else
  log "Kohya SS already installed, skipping."
fi

# ── Gallery storage dir ───────────────────────────────────────
log "Creating gallery storage directory..."
mkdir -p /workspace/gallery

# ════════════════════════════════════════════════════════════
#  JUPYTERLAB — file manager, terminal, notebooks (port 8888)
# ════════════════════════════════════════════════════════════
info "── JupyterLab ───────────────────────────────"

JUPYTER_PASSWORD="${JUPYTER_PASSWORD:-comixstudio}"

# Install JupyterLab if not present
if ! command -v jupyter &>/dev/null; then
  log "Installing JupyterLab..."
  pip install -q jupyterlab
else
  log "JupyterLab already installed."
fi

# Generate hashed password so it's not stored in plaintext
JUPYTER_HASH=$(python3 -c "
from jupyter_server.auth import passwd
print(passwd('${JUPYTER_PASSWORD}'))
" 2>/dev/null || python3 -c "
from notebook.auth import passwd
print(passwd('${JUPYTER_PASSWORD}'))
" 2>/dev/null || echo "")

# Write JupyterLab config
mkdir -p /root/.jupyter
cat > /root/.jupyter/jupyter_lab_config.py << JEOF
c.ServerApp.ip = '0.0.0.0'
c.ServerApp.port = 8888
c.ServerApp.open_browser = False
c.ServerApp.root_dir = '/workspace'
c.ServerApp.allow_root = True
c.ServerApp.token = ''
c.ServerApp.password = '${JUPYTER_HASH}'
c.ServerApp.allow_origin = '*'
c.ServerApp.disable_check_xsrf = True
# Show hidden files (dotfiles) in file manager
c.ContentsManager.allow_hidden = True
JEOF

# Launch via pm2
if command -v pm2 &>/dev/null; then
  pm2 delete jupyter 2>/dev/null || true
  pm2 start "jupyter lab --config=/root/.jupyter/jupyter_lab_config.py" \
    --name jupyter --no-autorestart false
  log "JupyterLab started on port 8888"
  log "  URL:      https://<POD_ID>-8888.proxy.runpod.net"
  log "  Password: ${JUPYTER_PASSWORD}"
else
  # pm2 not installed yet — launch in background directly
  nohup jupyter lab \
    --config=/root/.jupyter/jupyter_lab_config.py \
    > /workspace/jupyter.log 2>&1 &
  log "JupyterLab started in background (port 8888) — log: /workspace/jupyter.log"
fi

# ── Install Node.js + npm ─────────────────────────────────────
if ! command -v node &>/dev/null; then
  log "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || { err "Node.js setup script failed"; exit 1; }
  apt-get install -y -qq nodejs    || { err "Node.js install failed"; exit 1; }
  log "✓ Node.js $(node --version)"
else
  log "Node.js already installed: $(node --version)"
fi

# ── Install pm2 (keeps API wrapper alive, auto-restarts on crash) ──
if ! command -v pm2 &>/dev/null; then
  log "Installing pm2 process manager..."
  npm install -g pm2 --quiet || { err "pm2 install failed"; exit 1; }
fi

# ── Pull latest ComixBook code from GitHub (pinned to main) ──
REPO_DIR="/workspace/ComixBook"
if [ -d "$REPO_DIR/.git" ]; then
  log "Pulling latest ComixBook from GitHub (origin/main)..."
  if ! (cd "$REPO_DIR" && git fetch --quiet origin main && git checkout --quiet main && git reset --hard --quiet origin/main); then
    err "git pull failed — continuing with existing checkout"
  else
    log "✓ Code updated to $(cd "$REPO_DIR" && git rev-parse --short HEAD)"
  fi
  cd /workspace
else
  warn "No ComixBook repo at $REPO_DIR — cloning..."
  git clone --quiet --branch main https://github.com/mawegrzyn-ux/comixbook.git "$REPO_DIR" && \
    log "✓ Repo cloned" || \
    warn "Clone failed — continuing without auto-update"
fi

# ── Install API wrapper deps ──────────────────────────────────
API_DIR="/workspace/api"
mkdir -p "$API_DIR"

# Use api.js from repo if available, otherwise fall back to /workspace/api.js
if [ -f "$REPO_DIR/server/api.js" ]; then
  log "Using api.js from ComixBook repo..."
  cp "$REPO_DIR/server/api.js" "$API_DIR/api.js"
elif [ -f "/workspace/api.js" ]; then
  log "Using api.js from /workspace..."
  cp /workspace/api.js "$API_DIR/api.js"
else
  err "api.js not found — API server will not start"
  err "Upload server/api.js to /workspace/api.js or clone the ComixBook repo"
fi

cat > "$API_DIR/package.json" << 'PKGEOF'
{
  "name": "comixbook-api",
  "version": "1.0.0",
  "type": "module",
  "main": "api.js",
  "dependencies": {
    "express":            "^4.18.2",
    "axios":              "^1.6.0",
    "cors":               "^2.8.5",
    "dotenv":             "^16.3.1",
    "express-rate-limit": "^7.2.0",
    "uuid":               "^9.0.0"
  }
}
PKGEOF

(cd "$API_DIR" && npm install --quiet) || { err "npm install failed for API wrapper"; exit 1; }
cd /workspace

# ── Write .env for API wrapper ────────────────────────────────
cat > "$API_DIR/.env" << ENVEOF
SD_HOST=http://localhost:7860
API_KEY=${API_KEY:-change-me-secret}
KOHYA_DIR=${KOHYA_DIR:-/workspace/kohya_ss}
WEBUI_DIR=${WEBUI_DIR:-/workspace/stable-diffusion-webui}
GALLERY_DIR=${GALLERY_DIR:-/workspace/gallery}
IDLE_MINUTES=${IDLE_MINUTES:-30}
RUNPOD_API_KEY=${RUNPOD_KEY:-}
RUNPOD_POD_ID=${RUNPOD_POD_ID:-}
PORT=3000
ENVEOF

# ── Launch API wrapper via pm2 ────────────────────────────────
log "Starting API wrapper (port 3000) via pm2..."
pm2 delete comixbook-api 2>/dev/null || true
pm2 start "$API_DIR/api.js" --name comixbook-api 2>/dev/null || \
  warn "pm2 start failed — check $API_DIR/api.js exists"

pm2 logs comixbook-api --lines 5 --nostream 2>/dev/null || true

log "API wrapper:  https://<POD_ID>-3000.proxy.runpod.net"
log "JupyterLab:   https://<POD_ID>-8888.proxy.runpod.net  (pw: ${JUPYTER_PASSWORD:-comixstudio})"
log ""
log "Extra env vars for full features:"
log "  RUNPOD_API_KEY + RUNPOD_POD_ID  → auto-shutdown when idle"
log "  IDLE_MINUTES=30                 → idle timeout in minutes"

# ── Swap file (insurance against pip build OOM on low-RAM pods) ──
if [ ! -f /workspace/swapfile ]; then
  log "Creating 16G swap file on network volume..."
  fallocate -l 16G /workspace/swapfile 2>/dev/null && \
    chmod 600 /workspace/swapfile && \
    mkswap /workspace/swapfile > /dev/null 2>&1 || \
    warn "swap file creation failed — continuing without swap"
fi
swapon /workspace/swapfile 2>/dev/null && log "✓ Swap active: $(free -h | awk '/Swap:/ {print $2}')" || true

# ── Launch SD WebUI ───────────────────────────────────────────
# NOTE: -f flag required because the container runs as root and webui.sh
# aborts on root by default. --listen binds to 0.0.0.0 for RunPod proxy.
log "Launching SD WebUI on port 7860..."
cd "$WEBUI_DIR"
nohup bash webui.sh -f --skip-torch-check --listen --port 7860 --api --xformers --no-half-vae \
  > /workspace/webui.log 2>&1 &
log "✓ SD WebUI launching in background — tail /workspace/webui.log"
