# Deploy — GitHub + Render

## 1) GitHub

```bash
cd railsaarthi-ai
git remote add origin https://github.com/<your-username>/railsaarthi-ai.git
git branch -M main
git push -u origin main
```

Notes:
- `.env*` is git-ignored — real keys never leave your machine.
- If the remote requires auth, use a fine-grained Personal Access Token
  (repo contents: read/write) as the password, or `gh auth login`.

## 2) Render (one-click via blueprint)

1. Push to GitHub (above).
2. Render dashboard → **New → Blueprint** → select the repo.
3. `render.yaml` is detected automatically (Node 20, free plan, Singapore,
   health check `/api/health`).
4. Render prompts for the two secrets (`LLM_API_KEY`,
   `LLM_FALLBACK_API_KEY`) — paste your NVIDIA key (`nvapi-…`).
5. Apply → first build runs `npm ci && npm run build`, start is `npm run start`.
6. Verify: `https://<service>.onrender.com/api/health` → `{"ok":true,…}`
   and open `/chat` for a live conversation.

### Manual (alternative)
New → Web Service → repo → Build `npm ci && npm run build` →
Start `npm run start` → add the env vars listed in `render.yaml`
(values in the file; the two API keys from your NVIDIA account).

## Notes
- Railway providers (`confirmtkt-v1`, `erail-v1`, `web-data-v1`) are keyless —
  no extra credentials on Render.
- Booking/payment stay disabled (`BOOKING_ENABLED=false`).
- Free tier spins down after inactivity; first request may take ~30s.
