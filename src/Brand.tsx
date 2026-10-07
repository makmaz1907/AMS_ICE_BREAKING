// NTT DATA global logo. The PNG already includes the brand guide's clear space (0.5X left/right, 0.3X top/bottom), so don't crop or pad it.
// White is the guide's choice on dark backgrounds; the Dynamic Loop must never be shown without the logotype.
export function Logo({ className = "", variant = "white" }: { className?: string; variant?: "white" | "blue" }) {
  return <img alt="NTT DATA" className={className} draggable={false} src={`/brand/nttdata-logo-${variant}.png`} />;
}

// Event mark for the LE AMS team's ice breaker, always shown as a separate element below the NTT DATA logo, never merged with it.
// An ice cube cracking open: a letter tile on one side ("Bir Kelime"), an operator on the other ("Bir İşlem"). Drawn for dark backgrounds.
export function EventLogo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return <svg aria-label="LE AMS Ice Breaker" className={className} role="img" viewBox={compact ? "0 0 96 96" : "0 0 330 96"}>
    <defs>
      <linearGradient id="ice-face" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#00DFED" stopOpacity="0.28" /><stop offset="1" stopColor="#0072BC" stopOpacity="0.22" /></linearGradient>
    </defs>
    {/* Ice cube */}
    <rect fill="url(#ice-face)" height="78" rx="20" stroke="#00DFED" strokeWidth="3" width="78" x="9" y="9" />
    <path d="M22 26c3-6 8-9 15-10" fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeOpacity="0.7" strokeWidth="3" />
    {/* The crack, in the background colour so the cube reads as split in two */}
    <path d="M53 6 L45 33 L57 45 L43 62 L51 90" fill="none" stroke="#070F26" strokeLinejoin="round" strokeWidth="6" />
    <path d="M53 6 L45 33 L57 45 L43 62 L51 90" fill="none" stroke="#00DFED" strokeLinejoin="round" strokeOpacity="0.55" strokeWidth="1.5" />
    {/* Bir Kelime | Bir İşlem */}
    <text fill="#FFFFFF" fontFamily="'Noto Serif', Georgia, serif" fontSize="30" fontWeight="700" textAnchor="middle" x="28" y="60">A</text>
    <text fill="#00DFED" fontFamily="'Noto Sans', Arial, sans-serif" fontSize="34" fontWeight="700" textAnchor="middle" x="70" y="61">+</text>
    {/* Shards breaking off the crack */}
    <path d="M60 8l6-6M42 90l-5 5" stroke="#00DFED" strokeLinecap="round" strokeWidth="3" />
    {!compact && <>
      <text fill="#FFFFFF" fontFamily="'Noto Sans', Arial, sans-serif" fontSize="38" fontWeight="800" letterSpacing="3" x="110" y="52">LE AMS</text>
      <text fill="#00DFED" fontFamily="'Noto Sans', Arial, sans-serif" fontSize="15" fontWeight="700" letterSpacing="6.5" x="112" y="78">ICE BREAKER</text>
    </>}
  </svg>;
}

// "powered by aXet", redrawn as a vector for dark backgrounds: the original is a small screenshot with dark letters on a light card.
// a/e/t are white geometric strokes; the tall X keeps its blue gradient and still overshoots the x-height above and below.
export function PoweredBy({ className = "" }: { className?: string }) {
  return <svg aria-label="powered by aXet" className={className} role="img" viewBox="0 0 330 80">
    <defs>
      <linearGradient gradientUnits="userSpaceOnUse" id="axet-x" x1="0" x2="0" y1="4" y2="76"><stop offset="0" stopColor="#19A3FC" /><stop offset="1" stopColor="#0072BC" /></linearGradient>
    </defs>
    <text fill="#00DFED" fillOpacity="0.8" fontFamily="'Noto Sans', Arial, sans-serif" fontSize="17" fontWeight="700" letterSpacing="3.2" x="0" y="46">POWERED BY</text>
    <line stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="1.5" x1="160" x2="160" y1="16" y2="64" />
    <g transform="translate(176 0)">
      {/* a */}
      <circle cx="20" cy="40" fill="none" r="14.5" stroke="#FFFFFF" strokeWidth="11" />
      <rect fill="#FFFFFF" height="40" width="11" x="29.5" y="20" />
      {/* X: the stroke from the top right rises above the x-height, the other drops below the baseline */}
      <path d="M46 20 L77 75" stroke="url(#axet-x)" strokeWidth="12" />
      <path d="M79 4 L48 60" stroke="url(#axet-x)" strokeWidth="12" />
      {/* e: a ring open at the lower right, with its bar */}
      <circle cx="104" cy="40" fill="none" r="14.5" stroke="#FFFFFF" strokeDasharray="0 12.7 78.4" strokeWidth="11" />
      <rect fill="#FFFFFF" height="8" width="40" x="84" y="36" />
      {/* t */}
      <rect fill="#FFFFFF" height="54" width="11" x="134" y="6" />
      <rect fill="#FFFFFF" height="9" width="25" x="127" y="20" />
    </g>
  </svg>;
}
