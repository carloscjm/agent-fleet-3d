// Flat versions of the 3D icons, for the legend and the side panel (stroke = currentColor).
const P = {
  read: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 11h6M9.5 14h6M9.5 17h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l5 5"/>',
  edit: '<path d="M4 20l1.2-4.6L16.5 4.1a1.8 1.8 0 0 1 2.6 0l.8.8a1.8 1.8 0 0 1 0 2.6L8.6 18.8z"/><path d="M14.5 6l3.5 3.5"/>',
  write: '<path d="M6 3h7l4 4v6"/><path d="M13 3v4h4"/><path d="M6 3v18h7"/><path d="M18 16v6M15 19h6"/>',
  exec: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 10l3 2.5L7 15M12 15.5h5"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
  skill: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
  task: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9z"/><path d="M8.5 12.5l2 2 4-4M8.5 18h7"/>',
  mcp: '<path d="M9 3v4M15 3v4"/><rect x="6.5" y="7" width="11" height="7" rx="2"/><path d="M12 14v3a3 3 0 0 1-3 3H7"/>',
  agent: '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><circle cx="9.5" cy="12.5" r="1.2"/><circle cx="14.5" cy="12.5" r="1.2"/><path d="M12 7.5V4.5M12 3.5v.2M2.5 12v2.5M21.5 12v2.5"/>',
  prompt: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 10h.01M12 10h.01M15.5 10h.01"/>',
  plan: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9z"/><path d="M8 10.5l1.2 1.2 2-2M13 11h3M8 15.5l1.2 1.2 2-2M13 16h3"/>',
  build: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/><circle cx="12" cy="12" r="6.5"/>',
  test: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.3-4.4"/>',
  ship: '<path d="M12 2.5c3 2.4 4.5 5.6 4.5 9.5v4h-9v-4c0-3.9 1.5-7.1 4.5-9.5z"/><circle cx="12" cy="10" r="1.6"/><path d="M7.5 13.5L5 16.5v2h2.5M16.5 13.5L19 16.5v2h-2.5M10.5 19.5l1.5 2 1.5-2"/>',
  git: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="8.5" r="2"/><path d="M7 7.5v9M17 10.5c0 3.5-3 4.5-10 6"/>',
  other: '<path d="M12 3l7 9-7 9-7-9z"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
};

export function icon2d(key, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[key] || P.other}</svg>`;
}
