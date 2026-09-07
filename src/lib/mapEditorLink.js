// Keep editor navigation absent from the DOM unless the server identified an admin.
export function createMapEditorLink({ user, mapId, mapLabel, teamSize, document: dom = document }) {
  if (user?.isAdmin !== true) return null;
  const link = dom.createElement('a');
  const size = Math.max(1, Math.min(3, Number(teamSize) || 1));
  link.href = `/map-editor?map=${encodeURIComponent(mapId)}&variant=${size}v${size}`;
  link.className = 'map-choice-edit';
  link.setAttribute('aria-label', `Edit ${mapLabel || 'map'}`);
  link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg><span>Edit map</span>';
  return link;
}
