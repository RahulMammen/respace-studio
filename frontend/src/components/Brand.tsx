export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg viewBox="0 0 32 32" width={compact ? 26 : 30} height={compact ? 26 : 30} aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2b2a28" />
        <path d="M8 23V9h9a5 5 0 0 1 0 10h-9" fill="none" stroke="#f7f4ee" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="22.5" cy="22.5" r="2.6" fill="#8fa888" />
      </svg>
      {!compact && (
        <span className="brand-name">
          ReSpace <em>Studio</em>
        </span>
      )}
    </span>
  );
}
