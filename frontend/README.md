# Frontend

All files are standalone HTML — open directly in any browser. No build step, no npm, no server required locally.

## Files

### `comic-studio.html`
The main application. Tabs:
- **Characters** — define cast with descriptions, reference photos, LoRA weights
- **Locations** — define scenes with descriptions and time of day
- **Script** — write panel-by-panel with character/location tagging, art style picker, auto-prompt assembly
- **Composer** — arrange panels into page layouts, add speech bubbles, export PNG
- **LoRA Trainer** — 4-step pipeline: seed photos → generate variations → curate → train
- **Gallery** — browse all generated images, filter by tag, send to img2img

### `studio.html`
Advanced SD interface for power users:
- txt2img / img2img / inpaint tabs
- Consistency tab: IP-Adapter (character reference) + ControlNet (pose/depth)
- LoRA manager with per-LoRA weight sliders
- Prompt presets — save/load full character setups
- Gallery modal with auto-save
- Queue status badge
- Idle shutdown indicator

### `beginner.html`
Simplified interface — no jargon:
- Plain-language controls (Quality: Fast / Good / Best)
- Art style visual picker
- Click-to-add lighting, shot type, quality tags
- Before/after comparison slider
- "Different every time" vs "Same starting point" (hides seed concept)

## Connecting

All three frontends need the API server running. Enter your pod URL and API key in the settings/connection panel of each app.
