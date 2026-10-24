let uid = 0;
/** The ReverseIt mark: an "R" and an "I" inside a HUD ring. `bare` drops the dark tile (for use on dark artwork). */
export function Logo({ size = 38, withText = false, bare = false }: { size?: number; withText?: boolean; bare?: boolean }) {
  const id = 'lg' + ++uid;
  const svg = (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ReverseIt logo" style={bare ? undefined : { filter: 'drop-shadow(0 0 8px rgba(25,227,255,.4))' }}>
      <defs>
        <linearGradient id={id + 'c'} gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="54" y2="54"><stop offset="0" stopColor="#5df3ff" /><stop offset="1" stopColor="#12b6e6" /></linearGradient>
        <linearGradient id={id + 'o'} gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="56"><stop offset="0" stopColor="#ffb347" /><stop offset="1" stopColor="#ff7a12" /></linearGradient>
      </defs>
      {!bare && <rect width="64" height="64" rx="12" fill="#050b16" />}
      <circle cx="32" cy="32" r="28.5" fill="none" stroke="#19e3ff" strokeOpacity=".35" strokeWidth="1.2" strokeDasharray="2 3" />
      <path d="M32 3.5A28.5 28.5 0 0 1 60.5 32" fill="none" stroke={`url(#${id}o)`} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 60.5A28.5 28.5 0 0 1 3.5 32" fill="none" stroke={`url(#${id}c)`} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15.5 47V17h12.4a7.6 7.6 0 0 1 0 15.2H15.5" fill="none" stroke={`url(#${id}c)`} strokeWidth="4.6" />
      <path d="M27 32.2 36.5 47" fill="none" stroke={`url(#${id}c)`} strokeWidth="4.6" />
      <path d="M48.5 17V47" fill="none" stroke={`url(#${id}o)`} strokeWidth="4.6" />
    </svg>
  );
  if (!withText) return svg;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
      {svg}
      <span className="brand" style={{ padding: 0 }}><span>Reverse<b>It</b></span></span>
    </span>
  );
}
