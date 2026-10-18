import { useState } from "react";
import { useAuth } from "../state/auth";
import { BrandMark } from "../components/Brand";

export default function Login() {
  const { login, register, allowRegistration } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name || email.split("@")[0]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-art" aria-hidden="true">
        <svg viewBox="0 0 600 600" className="auth-plan">
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" stroke="#e3ddd1" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="600" height="600" fill="url(#grid)" />
          <path d="M90 110 H430 V300 H510 V500 H90 Z" fill="#fcfbf8" stroke="#2b2a28" strokeWidth="10" strokeLinejoin="miter" />
          <path d="M430 300 V360" stroke="#fcfbf8" strokeWidth="12" />
          <path d="M430 300 A60 60 0 0 1 490 360" fill="none" stroke="#a9a093" strokeWidth="1.5" strokeDasharray="4 4" />
          <rect x="140" y="400" width="210" height="62" rx="10" fill="#d8d0c2" stroke="#2b2a28" strokeWidth="1.5" />
          <rect x="190" y="300" width="110" height="58" rx="6" fill="#c9a27a" stroke="#2b2a28" strokeWidth="1.5" />
          <rect x="120" y="270" width="54" height="54" rx="10" fill="#a7b39b" stroke="#2b2a28" strokeWidth="1.5" />
          <rect x="318" y="270" width="54" height="54" rx="10" fill="#a7b39b" stroke="#2b2a28" strokeWidth="1.5" />
          <rect x="130" y="128" width="140" height="28" fill="#e9e3d8" stroke="#2b2a28" strokeWidth="1.5" />
          <path d="M110 380 C200 360 300 360 420 380" fill="none" stroke="#5f7a64" strokeWidth="2" strokeDasharray="6 6" />
          <text x="300" y="560" textAnchor="middle" fill="#857d71" fontSize="14" fontFamily="Inter, sans-serif" letterSpacing="3">
            5 400 × 4 200
          </text>
        </svg>
        <div className="auth-quote">
          <p>From a measured plan to editable interior proposals.</p>
          <p className="muted small">Concept design exploration. Not a substitute for building-code or structural review.</p>
        </div>
      </section>
      <section className="auth-panel">
        <BrandMark />
        <div style={{ display: "grid", gap: 6 }}>
          <h1>{mode === "login" ? "Welcome back" : "Create your studio"}</h1>
          <p className="muted">{mode === "login" ? "Sign in to continue to your projects." : "Projects are private to your account."}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && (
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {mode === "register" && <span className="muted small">At least 10 characters.</span>}
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary block" disabled={busy} type="submit">
            {busy ? <span className="spinner" /> : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        {allowRegistration && (
          <p className="muted">
            {mode === "login" ? "New to ReSpace? " : "Already have an account? "}
            <button className="link-btn" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
