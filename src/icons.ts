// Kladde's own line icons (24×24, stroke = currentColor).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pages: svg('<rect x="4" y="4" width="6.5" height="7" rx="1"/><rect x="13.5" y="4" width="6.5" height="7" rx="1"/><rect x="4" y="13" width="6.5" height="7" rx="1"/><rect x="13.5" y="13" width="6.5" height="7" rx="1"/>'),
  bookmark: svg('<path d="M7 4h10v16l-5-4-5 4z"/>'),
  bookmarkOn: svg('<path d="M7 4h10v16l-5-4-5 4z" fill="currentColor"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  share: svg('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/>'),
  more: svg('<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>'),
  undo: svg('<path d="M9 7H5V3"/><path d="M5.5 7A8 8 0 1 1 4 13"/>'),
  redo: svg('<path d="M15 7h4V3"/><path d="M18.5 7A8 8 0 1 0 20 13"/>'),
  pen: svg('<path d="M4 20l1.2-4.6L15.5 5.1a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.5 7l3.5 3.5"/>'),
  highlighter: svg('<path d="M9 14l6.5-9.5 4 3L13 17z"/><path d="M9 14l-1.5 3.5L10 20l3-3"/><path d="M4 21h5"/>'),
  eraser: svg('<path d="M8.5 19.5L3.8 14.8a1.5 1.5 0 0 1 0-2.1l8.6-8.6a1.5 1.5 0 0 1 2.1 0l5.3 5.3a1.5 1.5 0 0 1 0 2.1l-8.3 8z"/><path d="M8.5 19.5H20M8 8.5l7.5 7.5"/>'),
  shape: svg('<circle cx="8.5" cy="9" r="4.5"/><rect x="11" y="11.5" width="9" height="8.5" rx="1"/>'),
  lasso: svg('<path d="M7 17.5C4.5 16 3.5 14 3.5 11.5 3.5 7 7.5 4 12 4s8.5 3 8.5 7.5-4 7.5-8.5 7.5c-1.3 0-2.5-.2-3.6-.6" stroke-dasharray="2.6 2.6"/><path d="M8.4 18.4c.6 1 .2 2.3-.9 2.6"/>'),
  text: svg('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>'),
  sync: svg('<path d="M19.5 9A8 8 0 0 0 5 7.5M4.5 15A8 8 0 0 0 19 16.5"/><path d="M5 3.5v4h4M19 20.5v-4h-4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>'),
  folder: svg('<path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>'),
  star: svg('<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>'),
  starOn: svg('<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="currentColor"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  docs: svg('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  laser: svg('<circle cx="17" cy="7" r="2.6" fill="currentColor"/><path d="M14.8 9.2L4 20" stroke-dasharray="2 2.4"/>'),
  ruler: svg('<rect x="2.5" y="8" width="19" height="8" rx="1" transform="rotate(-30 12 12)"/><path d="M7.2 11.6l1 1.7M10 10l1.3 2.2M12.7 8.4l1 1.7M15.5 6.8l1.3 2.2" />'),
  zoomwin: svg('<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 13.5h17"/><rect x="7" y="6.5" width="5" height="4" rx=".5"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  newline: svg('<path d="M19 6v6a2 2 0 0 1-2 2H6"/><path d="M9 10.5L5.5 14 9 17.5"/>'),
  trash: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
};

export type IconName = keyof typeof icons;
