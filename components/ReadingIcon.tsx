import React from 'react';

const paths: Record<string, React.ReactNode> = {
  book: <><path d="M12 5C8.5 2.6 5 3 2 4v15c3-1 6.5-1.4 10 1 3.5-2.4 7-2 10-1V4c-3-1-6.5-1.4-10 1Z"/><path d="M12 5v15"/></>,
  headphones: <><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></>,
  library: <><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="9" y="3" width="4" height="18" rx="1"/><path d="m16 3 5 17-4 1-5-17"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  paste: <><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3M8 11h8M8 15h6"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></>,
  play: <path d="m8 5 11 7-11 7Z" fill="currentColor" strokeWidth="0"/>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" strokeWidth="0"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" strokeWidth="0"/></>,
  back: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/><text x="8" y="16" stroke="none" fill="currentColor" fontSize="8" fontWeight="700">10</text></>,
  forward: <><path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6"/><text x="8" y="16" stroke="none" fill="currentColor" fontSize="8" fontWeight="700">10</text></>,
  volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  muted: <><path d="m11 4-6 5H2v6h3l6 5Z"/><path d="m16 9 6 6m0-6-6 6"/></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 .5-2 1-2 3M12 17h.01"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  leaf: <><path d="M20 3C9 2 3 8 5 15s14 5 15-12Z"/><path d="m4 21 10-11"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  note: <><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/></>,
};

export function ReadingIcon({ name, className = '', ...props }: {name: string; className?: string} & React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`icon ${className}`} {...props}>{paths[name] || paths.book}</svg>;
}
