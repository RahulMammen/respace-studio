import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toasts } from "./components/common";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import { useAuth } from "./state/auth";

const Workspace = lazy(() => import("./workspace/Workspace"));
const Summary = lazy(() => import("./pages/Summary"));

function Loading() {
  return (
    <div className="center-screen" role="status">
      <span className="spinner" /> <span className="muted">Loading…</span>
    </div>
  );
}

export default function App() {
  const { user, ready, load } = useAuth();
  useEffect(() => {
    void load();
  }, [load]);
  if (!ready) return <Loading />;
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        {!user ? (
          <Routes>
            <Route path="*" element={<Login />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<Projects />} />
            <Route path="/projects/:projectId" element={<Workspace />} />
            <Route path="/projects/:projectId/summary/:alternativeId" element={<Summary />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </Suspense>
      <Toasts />
    </BrowserRouter>
  );
}
