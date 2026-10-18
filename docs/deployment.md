# Deployment and hosting

## What exists today
- **Source code** is published on GitHub (`RahulMammen/respace-studio`). This does **not** mean a hosted app is available.
- **Local release**: `scripts/start.ps1` serves the production build and API from one process on `127.0.0.1:8000`.
- **Same-network pilot**: `scripts/start.ps1 -Lan` binds `0.0.0.0` over plain HTTP. It never changes firewall settings. Use it only on a trusted private network, and stop it after the session.

## Production build
```powershell
cd frontend; npm ci; npm run build      # outputs frontend/dist, served by FastAPI
cd ../backend; .venv\Scripts\python -m app.serve --port 8000
```
Database migrations run automatically at startup (Alembic `upgrade head`). Data lives in `backend/data/` (SQLite and uploads). Back that folder up to keep projects.

## Requirements before any hosted or public testing
These need your decision and, where noted, accounts or spending. None has been set up.
1. **Hosting account** for a small VM or container platform (for example a single small instance). It may cost money; nothing has been purchased.
2. **Domain and HTTPS**: a reverse proxy (Caddy or nginx) terminating TLS. Then set `COOKIE_SECURE=true`.
3. **Persistent storage** for `backend/data/` and backups. Postgres (with a `DATABASE_URL` change) is recommended once there are several concurrent users.
4. **AI data handling**: the Gemini free tier may use content for product improvement and human review. For real client plans, use a paid tier whose terms exclude training, after you decide to enable billing.
5. **Access control**: set `ALLOW_REGISTRATION=false` after creating tester accounts, or put the app behind an access gate.
6. **Privacy**: only synthetic or anonymised plans in any shared demo.

Until these are approved, keep testing local or LAN-only.
