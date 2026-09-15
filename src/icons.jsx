import React from 'react';

const paths = {
  arm: <><path d="M4 21h12M6 21v-4h8v4M10 17v-6l5-5 4 4-5 5"/><circle cx="10" cy="9" r="2"/><circle cx="17" cy="7" r="2"/><path d="m19 10 2 3-3 2"/></>,
  cube: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/></>,
  activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
  hand: <><path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1c-3 0-4-2-6-4l-3-4a1.5 1.5 0 0 1 2-2l3 2"/></>,
  chip: <><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/></>,
  wifi: <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/></>,
  magnet: <><path d="M5 4v10a7 7 0 0 0 14 0V4h-5v10a2 2 0 0 1-4 0V4H5Z"/><path d="M5 8h5m4 0h5"/></>,
  arrow: <path d="M4 12h16m-5-5 5 5-5 5"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  play: <path d="m8 5 11 7-11 7V5Z"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-8h6v8"/></>,
  reset: <><path d="M3 10a9 9 0 1 1 1 8M3 4v6h6"/></>,
  alert: <><path d="m9 3-6 6v6l6 6h6l6-6V9l-6-6H9Z"/><path d="M12 7v6m0 4h.01"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>,
  screen: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  link: <><path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></>,
  target: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
  axes: <><path d="M6 18V3m0 15h15M6 18l8-8M3 6l3-3 3 3m9 9 3 3-3 3m-7-11h3v3"/></>,
  trail: <><path d="M3 19c0-10 18 4 18-9 0-9-18-8-18 1"/><circle cx="3" cy="11" r="2"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>,
  code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/></>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/></>,
  mouse: <><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
};
export function Icon({ name, size = 18, className = '', ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...props}>{paths[name] || paths.cube}</svg>;
}
