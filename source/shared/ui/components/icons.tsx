const P: Record<string, string> = {
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.2-1.2A4 4 0 0 1 15 7zm1.5 2.5h.01',
  book: 'M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  file: 'M6 2h8l5 5v15H6zM14 2v5h5',
  paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h6',
  net: 'M4 12h4l2-6 4 12 2-6h4',
  doc: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.6-2-.5-1.3.3-2.5 1.7-2.5H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5zM7.5 12h.01M9 8h.01M14 7.5h.01',
  graph: 'M6 6a2 2 0 1 0 0 .01M18 6a2 2 0 1 0 0 .01M12 18a2 2 0 1 0 0 .01M8 6h8M7 8l4 8M17 8l-4 8',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 6h16M4 12h16M4 18h16',
  play: 'M7 4v16l13-8z',
  stop: 'M6 6h12v12H6z',
  warn: 'M12 3 2 20h20zM12 10v5M12 18h.01',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  github: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.300.1-2.700 0 0 .8-.3 2.800 1a9.600 9.600 0 0 1 5 0c1.900-1.300 2.800-1 2.800-1 .5 1.400.2 2.400.1 2.700.6.7 1 1.600 1 2.700 0 3.900-2.400 4.700-4.600 5 .4.3.7.9.7 1.900v2.800c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
  linkedin: 'M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h4v2c.6-1.200 2-2.200 4-2.200 3.500 0 4 2.300 4 5.200V21h-4v-6c0-1.500-.1-3-2-3s-2 1.500-2 3v6h-4z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.500 6.500h.01',
  xsocial: 'M4 4l16 16M20 4 4 20',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  copy: 'M9 9h11v12H9zM5 15H4V3h12v2',
  refresh: 'M20 11a8 8 0 1 0-2.300 5.700M20 4v7h-7',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};
export function Icon({ name, size = 18, stroke = 1.7 }: { name: string; size?: number; stroke?: number }) {
  const d = P[name] ?? P.spark;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
