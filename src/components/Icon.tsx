/** Small inline icon set (24×24, stroked). */
const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
  cue: 'M5 5h3v14H5zM10 12l9-7v14z',
  sync: 'M4 12a8 8 0 0 1 13.66-5.66L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.66 5.66L4 15.5M4 20v-4.5h4.5',
  loop: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1',
  sparkle:
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  record: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  stop: 'M6 6h12v12H6z',
  x: 'M18 6L6 18M6 6l12 12',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  disc: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  pads: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  robot:
    'M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 13h.01M15 13h.01M9 17h6',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
  wave: 'M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  midi: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 11h.01M12 8h.01M16 11h.01M9.5 15h.01M14.5 15h.01',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  queue: 'M3 6h12M3 12h12M3 18h7M17 15v6M14 18h6',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4',
  headphones: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  eject: 'M5 17h14M12 5l7 8H5z',
  skip: 'M5 4l10 8-10 8zM19 5v14',
};

const FILLED = new Set(['play', 'pause', 'cue', 'record', 'stop', 'sparkle', 'bolt', 'eject', 'skip']);

export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = FILLED.has(name);
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
