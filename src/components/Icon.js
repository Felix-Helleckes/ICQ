import React from 'react';

/**
 * Line icons for the app chrome (toolbars, menus, status).
 *
 * These replace the emoji that used to sit in buttons and menu entries. Emoji are
 * rendered by the OS font, so their weight, colour and baseline differ per platform
 * and they never match the retro look. These are drawn on a 24×24 grid with a single
 * stroke width, inherit `currentColor`, and therefore pick up hover/disabled states
 * from the button they live in.
 *
 * Emoji that are *content* — the emoji picker, emoji inside messages, the game
 * entries — are deliberately left alone. Same for the ✿ brand mark.
 */

// Paths are stroked unless listed in FILLED.
const FILLED = new Set(['heart', 'dot']);

const PATHS = {
  // sound
  bell: 'M11 5.2a1 1 0 0 1 2 0 5.6 5.6 0 0 1 4.6 5.5v3.1l1.5 2.6H4.9l1.5-2.6v-3.1A5.6 5.6 0 0 1 11 5.2z|M10 19.4a2.2 2.2 0 0 0 4 0',
  'bell-off': 'M11 5.2a1 1 0 0 1 2 0 5.6 5.6 0 0 1 4.6 5.5v3.1l1.5 2.6H4.9l1.5-2.6v-3.1A5.6 5.6 0 0 1 11 5.2z|M10 19.4a2.2 2.2 0 0 0 4 0|M3.5 3.5 20.5 20.5',
  // sidebar / chrome
  palette: 'M12 3.2a8.8 8.8 0 1 0 0 17.6c1.3 0 1.9-.9 1.9-1.8 0-1.2-1-1.6-1-2.6 0-.8.7-1.4 1.5-1.4h1.6a4.8 4.8 0 0 0 4.8-4.8C20.8 6.3 16.9 3.2 12 3.2z|M7.6 10.3v.01|M11.4 6.6v.01|M16 8.7v.01',
  gamepad: 'M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.4a2.6 2.6 0 0 1-4.6 1L14 15.4h-4l-1.6 1.9a2.6 2.6 0 0 1-4.6-1l-.7-3.4A4.5 4.5 0 0 1 7.5 7.5z|M7.4 11.4h2.2M8.5 10.3v2.2|M15 11h.01M17 12.6h.01',
  logout: 'M15 16.5v1.6a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2V5.9a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2v1.6|M10.4 12h9.4|M16.7 8.9 19.8 12l-3.1 3.1',
  check: 'M4.6 12.6 9.4 17.4 19.4 7',
  'check-double': 'M2.6 12.6 6.6 16.6 14.4 8.8|M9.6 12.9 12.6 16 21 7.6',
  clock: 'M12 6.6V12l3.2 1.9|M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8z',
  heart: 'M12 20.7 4.3 13a4.9 4.9 0 0 1 6.9-6.9l.8.8.8-.8A4.9 4.9 0 0 1 19.7 13z',
  // chat toolbar
  paperclip: 'M20 11.1 12.3 18.8a4.9 4.9 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.6 4.6l-8.3 8.3a1.6 1.6 0 0 1-2.3-2.3l7.4-7.4',
  mic: 'M9.2 5.6a2.8 2.8 0 0 1 5.6 0v5a2.8 2.8 0 0 1-5.6 0z|M5.8 11.4a6.2 6.2 0 0 0 12.4 0|M12 17.6V21M9 21h6',
  stop: 'M6.6 6.6h10.8v10.8H6.6z',
  play: 'M8.4 5.6 18 12l-9.6 6.4z',
  pause: 'M9.2 5.8v12.4M14.8 5.8v12.4',
  smile: 'M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8z|M8.6 14.2a4.3 4.3 0 0 0 6.8 0|M9.2 9.6v.01M14.8 9.6v.01',
  x: 'M6 6 18 18M18 6 6 18',
  alert: 'M12 8.6v4.6M12 16.6v.01|M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9|M20.4 3.4v4.4h-4.4',
  lock: 'M6.6 10.6h10.8a1.6 1.6 0 0 1 1.6 1.6v6.2a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 18.4v-6.2a1.6 1.6 0 0 1 1.6-1.6z|M8.4 10.6V7.8a3.6 3.6 0 0 1 7.2 0v2.8',
  // login panel
  chat: 'M8 13.5h5M8 10h7|M3.5 17.2V6.8A2.3 2.3 0 0 1 5.8 4.5h12.4a2.3 2.3 0 0 1 2.3 2.3v7.6a2.3 2.3 0 0 1-2.3 2.3H8.4L4.6 20z',
  send: 'M21 3.4 10.6 13.8|M21 3.4 14.4 21l-3.8-7.2L3.4 10z',
  qr: 'M4.2 4.2h5.2v5.2H4.2zM14.6 4.2h5.2v5.2h-5.2zM4.2 14.6h5.2v5.2H4.2z|M14.6 14.6h2.1M19.8 14.6v2.1M17.7 17.7h2.1M14.6 19.8h2.1M19.8 19.8h.01',
  phone: 'M8.1 3.6H15.9a1.8 1.8 0 0 1 1.8 1.8v13.2a1.8 1.8 0 0 1-1.8 1.8H8.1a1.8 1.8 0 0 1-1.8-1.8V5.4a1.8 1.8 0 0 1 1.8-1.8z|M10.8 17.7h2.4',
  star: 'M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.9l5.8-.8z',
  'arrow-left': 'M19.4 12H4.6|M10.4 5.8 4.2 12l6.2 6.2',
};

export default function Icon({ name, size = 16, strokeWidth = 1.7, className = '', title }) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = FILLED.has(name);
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
