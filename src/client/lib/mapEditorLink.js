// Keep editor navigation absent from the DOM unless the server identified an admin.
export function createMapEditorLink({ user, mapId, mapLabel, teamSize, document: dom = document }) {
  if (user?.isAdmin !== true) return null;
  const link = dom.createElement('a');
  const size = Math.max(1, Math.min(3, Number(teamSize) || 1));
  link.href = `/map-editor?map=${encodeURIComponent(mapId)}&variant=${size}v${size}`;
  link.className = 'map-choice-edit mode-info-button';
  link.title = 'Edit map';
  link.setAttribute('aria-label', `Edit ${mapLabel || 'map'}`);
  link.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="#2a2f3a" d="M1 10h1v1h-1z"/><path fill="#f3d2a2" d="M2 8h1v1h-1zM2 9h1v1h-1zM3 9h1v1h-1z"/><path fill="#ffe27a" d="M3 7h1v1h-1zM4 6h1v1h-1zM5 5h1v1h-1zM6 4h1v1h-1zM7 3h1v1h-1z"/><path fill="#ffc93c" d="M3 8h1v1h-1zM4 7h1v1h-1zM5 6h1v1h-1zM6 5h1v1h-1zM7 4h1v1h-1z"/><path fill="#d9902b" d="M4 8h1v1h-1zM5 7h1v1h-1zM6 6h1v1h-1zM7 5h1v1h-1zM8 4h1v1h-1z"/><path fill="#e4ecf5" d="M8 2h1v1h-1z"/><path fill="#b8c4d3" d="M8 3h1v1h-1z"/><path fill="#ffb3c4" d="M9 1h1v1h-1z"/><path fill="#ff8aa6" d="M9 2h1v1h-1z"/><path fill="#7c8ba0" d="M9 3h1v1h-1z"/><path fill="#d95f80" d="M10 1h1v1h-1zM10 2h1v1h-1z"/><path fill="#0b1a33" d="M2 10h1v1h-1zM0 10h1v1h-1zM1 11h1v1h-1zM1 9h1v1h-1zM1 8h1v1h-1zM2 7h1v1h-1zM3 6h1v1h-1zM4 9h1v1h-1zM3 10h1v1h-1zM4 5h1v1h-1zM5 8h1v1h-1zM5 4h1v1h-1zM6 7h1v1h-1zM6 3h1v1h-1zM7 6h1v1h-1zM7 2h1v1h-1zM8 5h1v1h-1zM8 1h1v1h-1zM9 4h1v1h-1zM9 0h1v1h-1zM10 3h1v1h-1zM11 1h1v1h-1zM10 0h1v1h-1zM11 2h1v1h-1z"/></svg>';
  return link;
}
