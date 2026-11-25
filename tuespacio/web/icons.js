const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ticket:
    '<path d="M4 4h16v6a2 2 0 0 0 0 4v6H4v-6a2 2 0 0 0 0-4zM15 4v3m0 3v4m0 3v3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  car: '<path d="m5 9 2-5h10l2 5m-16 0h18v9H3zM6 18v3m12-3v3M6 13h2m8 0h2"/>',
  moto: '<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 5-8 5 8M9 9h9l-2-6h-3M9 6h4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0v7l2 2H4l2-2zm4 12h4"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 3-3 2 3 2-1 3 3 1 1 3h6l1-3 3-1-1-3 3-2-3-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  exit: '<path d="M9 4H4v16h5m0-8h12m-5-5 5 5-5 5"/>',
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6m-6 11h6"/>',
  wallet:
    '<path d="M20 7H4a2 2 0 0 1 0-4h14v4m2 0v14H3V7m17 4h-6v6h6M17 14h.01"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  roof: '<path d="m2 10 10-7 10 7M5 10v11h14V10M9 21v-7h6v7"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-5-5 3-3m-1 5 3-3"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  refresh:
    '<path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    paths[name] || paths.info
  }</svg>`;
