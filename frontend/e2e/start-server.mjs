// Starts the production backend (serving frontend/dist) with an isolated data
// directory and the CI-only AI test double, unless LIVE_AI=1 is set for a manual live run.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const backend = resolve(import.meta.dirname, "../../backend");
const venvPython = process.platform === "win32" ? join(backend, ".venv", "Scripts", "python.exe") : join(backend, ".venv", "bin", "python");
const python = process.env.PYTHON ?? (existsSync(venvPython) ? venvPython : "python");
const data = mkdtempSync(join(tmpdir(), "respace-e2e-"));
const port = process.env.E2E_PORT ?? "8123";

const child = spawn(python, ["-m", "app.serve", "--port", port], {
  cwd: backend,
  stdio: "inherit",
  env: {
    ...process.env,
    DATA_DIR: data,
    DATABASE_URL: `sqlite:///${join(data, "e2e.sqlite3").replaceAll("\\", "/")}`,
    // LIVE_AI=1 (manual only) uses the real provider and the key from backend/.env.
    ...(process.env.LIVE_AI ? { AI_PROVIDER: "gemini" } : { AI_PROVIDER: "mock", GEMINI_API_KEY: "" }),
    SESSION_SECRET: "e2e-only-secret",
  },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
