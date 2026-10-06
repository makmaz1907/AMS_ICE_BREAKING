// NTT DATA global logo. The PNG already includes the brand guide's clear space (0.5X left/right, 0.3X top/bottom), so don't crop or pad it.
// White is the guide's choice on dark backgrounds; the Dynamic Loop must never be shown without the logotype.
export function Logo({ className = "", variant = "white" }: { className?: string; variant?: "white" | "blue" }) {
  return <img alt="NTT DATA" className={className} draggable={false} src={`/brand/nttdata-logo-${variant}.png`} />;
}
