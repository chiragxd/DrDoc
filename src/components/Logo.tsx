/**
 * DrDoc mark: a document with a folded corner and a medical cross.
 * Uses currentColor-free fills so it reads on both light and dark backgrounds.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8.5 2.5h11.2l8.3 8.3V27a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 6 27V5a2.5 2.5 0 0 1 2.5-2.5Z" fill="var(--brand)" />
      <path d="M19.7 2.5v6.3a2 2 0 0 0 2 2H28" fill="none" stroke="var(--brand-ink)" strokeOpacity=".35" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="15" y="13" width="4" height="12" rx="1.2" fill="var(--brand-ink)" />
      <rect x="11" y="17" width="12" height="4" rx="1.2" fill="var(--brand-ink)" />
    </svg>
  );
}

export function Logo() {
  return (
    <a href="#/" className="brand" aria-label="DrDoc home">
      <LogoMark />
      <span>
        <span className="dr">Dr</span>Doc
      </span>
    </a>
  );
}
