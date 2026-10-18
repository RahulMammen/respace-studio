import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { MaterialInfo } from "../api/types";
import { swatchUrl, PALETTE_COLORS } from "../catalog/materials";
import { useUI } from "../state/ui";

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  labelledBy,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex='0']")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} ref={ref}>
        <header>
          <div style={{ display: "grid", gap: 4 }}>
            <h2 id={labelledBy ?? id}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" data-close>
            <X size={18} />
          </button>
        </header>
        {children}
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "error" ? "error" : ""}`}>
          <span>{t.text}</span>
          <span style={{ display: "flex", gap: 6 }}>
            {t.action && (
              <button
                className="btn sm"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="btn sm ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Number input in metres that commits on blur/Enter and clamps to bounds. */
export function MetreInput({
  value,
  onCommit,
  min,
  max,
  step = 0.01,
  label,
  unit = "m",
  disabled,
  digits = 2,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  unit?: string;
  disabled?: boolean;
  digits?: number;
  testId?: string;
}) {
  const [text, setText] = useState(value.toFixed(digits));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value.toFixed(digits);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) {
      setText(value.toFixed(digits));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    setText(clamped.toFixed(digits));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="unit-input" data-unit={unit}>
        <input
          className="input num"
          inputMode="decimal"
          value={shown}
          disabled={disabled}
          data-testid={testId}
          aria-label={label}
          onFocus={() => {
            setText(value.toFixed(digits));
            setFocused(true);
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const v = Number(text) + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
              const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
              setText(clamped.toFixed(digits));
              onCommit(clamped);
            }
          }}
        />
      </span>
    </label>
  );
}

export function MaterialPicker({
  materials,
  catalog,
  value,
  onChange,
  disabled,
  label = "Material",
}: {
  materials: string[];
  catalog: Record<string, MaterialInfo>;
  value: string;
  onChange: (m: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {materials.map((m) => {
          const info = catalog[m];
          return (
            <button
              key={m}
              role="radio"
              aria-checked={value === m}
              className="swatch"
              disabled={disabled}
              title={info?.label ?? m}
              onClick={() => onChange(m)}
              style={{ backgroundImage: `url(${swatchUrl(info, info?.color ?? "#cccccc")})` }}
            >
              <span>{info?.label ?? m}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange, disabled, label = "Colour" }: { value: string; onChange: (c: string) => void; disabled?: boolean; label?: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="colors" role="radiogroup" aria-label={label}>
        {PALETTE_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={value.toLowerCase() === c}
            aria-label={c}
            className="color-dot"
            disabled={disabled}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <label className="color-dot custom" title="Custom colour">
          <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
        </label>
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    valid: ["ok", "Checks pass"],
    warnings: ["warn", "Check warnings"],
    invalid: ["error", "Needs attention"],
    unchecked: ["", "Not checked"],
  };
  const [cls, text] = map[status] ?? ["", status];
  return <span className={`chip ${cls}`}>{text}</span>;
}

export function OriginChip({ origin }: { origin: string }) {
  const map: Record<string, [string, string]> = {
    ai: ["dark", "AI proposal"],
    sample: ["outline", "Sample · not AI"],
    manual: ["outline", "Manual"],
    import: ["outline", "Imported"],
  };
  const [cls, text] = map[origin] ?? ["", origin];
  return <span className={`chip ${cls}`}>{text}</span>;
}
