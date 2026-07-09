// Golden Egg logo — an egg-shape with concentric ripple rings.
// Geometric, single-color (currentColor), works from 24px to 200px.
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      aria-label="Golden Egg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Egg silhouette */}
      <path
        d="M16 3c-5 0-9 5.5-9 12.5S11 27 16 27s9-4.5 9-11.5S21 3 16 3z"
        stroke="currentColor"
        strokeWidth="1.75"
        fill="none"
      />
      {/* Inner ripple 1 */}
      <ellipse cx="16" cy="16" rx="4.5" ry="5.5" stroke="currentColor" strokeWidth="1.25" fill="none" opacity="0.55" />
      {/* Center dot */}
      <circle cx="16" cy="16" r="1.4" fill="currentColor" />
    </svg>
  );
}
