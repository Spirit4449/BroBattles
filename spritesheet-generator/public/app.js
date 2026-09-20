/* One UI over the same persisted operations used by cli.js. */
const $ = id => document.getElementById(id);
const state = {
  key: '',
  project: null,
  animation: 'idle',
  index: 0,
  selected: new Set(),
  images: new Map(),
  playing: false,
  elapsed: 0,
  busy: false,
  reference: null,
  transition: null,
  stroke: null
};
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : {
    method: 'POST',
    headers: data instanceof FormData ? {} : {
      'Content-Type': 'application/json'
    },
    body: data instanceof FormData ? data : JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.error || 'Request failed');
    e.code = result.code;
    throw e;
  }
  return result;
}
function endpoint(suffix = '') {
  return `/api/projects/${state.key}${suffix}`;
}
function active() {
  return state.project?.animations.find(a => a.key === state.animation);
}
function current() {
  return state.project?.frames[active()?.frames[state.index]];
}
function controls() {
  document.querySelectorAll('[data-project]').forEach(e => {
    e.disabled = !state.project || state.busy;
  });
  $('undo').disabled ||= !state.project?.past.length;
  $('redo').disabled ||= !state.project?.future.length;
  $('export').disabled ||= !state.project?.normalized;
  $('projects').disabled = state.busy;
  $('create').disabled = state.busy;
  $('replacement').disabled = state.busy || !current();
  document.querySelectorAll('#grid button').forEach(e => {
    e.disabled = state.busy;
  });
}
async function work(fn, message = 'Saved.') {
  if (state.busy) return;
  state.busy = true;
  state.playing = false;
  controls();
  try {
    await fn();
    status(message);
  } catch (e) {
    if (e.code === 'CONFLICT') await refresh();
    status(e.message, true);
  } finally {
    state.busy = false;
    controls();
  }
}
async function apply(ops) {
  await work(async () => {
    await adopt(await api(endpoint('/edit'), {
      revision: state.project.revision,
      ops
    }));
  });
}
function frameUrl(id, native = false) {
  return `${endpoint(`/frames/${id}`)}?revision=${state.project.revision}${native ? '&native=1' : ''}`;
}
function imageFor(id, native = false) {
  if (!id) return null;
  const key = `${id}:${native}`;
  if (!state.images.has(key)) {
    const img = new Image();
    img.src = frameUrl(id, native);
    state.images.set(key, img);
  }
  return state.images.get(key);
}
function option(value, text = value) {
  const e = document.createElement('option');
  e.value = value;
  e.textContent = text;
  return e;
}
async function listProjects() {
  const projects = await api('/api/projects');
  $('projects').replaceChildren(option('', 'Open a project…'), ...projects.map(p => option(p.key, p.name)));
  $('projects').value = state.key;
}
async function adopt(p) {
  state.project = p;
  state.images.clear();
  if (!active()) state.animation = 'idle';
  state.index = Math.min(state.index, Math.max(0, active().frames.length - 1));
  state.selected = new Set([...state.selected].filter(id => !!p.frames[id]));
  if (!state.selected.size && current()) state.selected.add(current().id);
  for (const id of ['import-animation', 'assign-to', 'transition']) {
    const value = $(id).value;
    $(id).replaceChildren(...(id === 'transition' ? [option('', 'None')] : id === 'import-animation' ? [option('', 'Auto (atlas) / idle')] : []), ...p.animations.map(a => option(a.key)));
    if ([...$(id).options].some(o => o.value === value)) $(id).value = value;
  }
  $('title').textContent = p.name;
  $('subtitle').textContent = `Revision ${p.revision} · ${Object.keys(p.frames).length} frames · ${p.animations.length} animation rows`;
  $('normalization').textContent = p.normalized ? '256 × 256 · normalized' : 'Original dimensions · normalize before export';
  renderGrid();
  inspector();
  controls();
  updateURL();
}
async function refresh() {
  if (state.key) await adopt(await api(endpoint()));
}
function updateURL() {
  if (state.key) history.replaceState(null, '', `?${new URLSearchParams({
    project: state.key,
    animation: state.animation,
    ...(current() ? {
      frame: current().id
    } : {})
  })}`);
}
function select(animation, index, event = {}) {
  const oldIndex = state.index,
    same = state.animation === animation;
  state.animation = animation;
  state.index = index;
  state.playing = false;
  state.elapsed = 0;
  const id = current()?.id;
  if (event.shiftKey && same) {
    for (let i = Math.min(oldIndex, index); i <= Math.max(oldIndex, index); i++) state.selected.add(active().frames[i]);
  } else if ((event.metaKey || event.ctrlKey) && id) {
    if (state.selected.has(id)) state.selected.delete(id);else state.selected.add(id);
  } else state.selected = new Set(id ? [id] : []);
  renderGrid();
  inspector();
  updateURL();
}
function renderGrid() {
  $('grid').replaceChildren();
  if (!state.project) return;
  const cols = Math.max(8, ...state.project.animations.map(a => a.frames.length));
  for (const a of state.project.animations) {
    const row = document.createElement('div');
    row.className = 'animation-row';
    const label = document.createElement('button');
    label.className = `row-label ${a.key === state.animation ? 'active' : ''}`;
    label.textContent = a.key;
    const count = document.createElement('small');
    count.textContent = `${a.frames.length} frames · ${a.fps} fps`;
    label.append(count);
    label.onclick = () => select(a.key, 0);
    row.append(label);
    for (let i = 0; i < cols; i++) {
      const id = a.frames[i],
        f = state.project.frames[id],
        button = document.createElement('button');
      button.className = `frame ${id ? '' : 'empty'} ${state.selected.has(id) ? 'selected' : ''} ${id && current()?.id === id ? 'current' : ''}`;
      if (f) {
        const img = document.createElement('img');
        img.src = frameUrl(id);
        img.alt = f.name;
        img.loading = 'lazy';
        const text = document.createElement('small');
        text.textContent = `${i + 1} · ${f.name}`;
        button.append(img, text);
        button.title = `${f.name}\n${f.width}×${f.height}\n${id}`;
        button.draggable = true;
        button.onclick = event => select(a.key, i, event);
        button.ondragstart = e => e.dataTransfer.setData('text/plain', JSON.stringify({
          animation: a.key,
          ids: state.selected.has(id) ? a.frames.filter(f => state.selected.has(f)) : [id]
        }));
        button.ondragover = e => e.preventDefault();
        button.ondrop = e => {
          e.preventDefault();
          let payload;
          try {
            payload = JSON.parse(e.dataTransfer.getData('text/plain'));
          } catch {
            return;
          }
          if (payload.animation !== a.key) return;
          const rest = a.frames.filter(f => !payload.ids.includes(f));
          const at = rest.indexOf(id);
          rest.splice(at < 0 ? rest.length : at, 0, ...payload.ids);
          apply([{
            op: 'reorder',
            animation: a.key,
            ids: rest
          }]);
        };
      } else {
        button.textContent = '+';
        button.title = `Append blank frame to ${a.key}`;
        button.onclick = () => apply([{
          op: 'blank',
          animation: a.key
        }]);
      }
      row.append(button);
    }
    $('grid').append(row);
  }
}
function inspector() {
  const a = active(),
    f = current();
  $('selection').textContent = f ? `${state.selected.size} selected · ${f.width}×${f.height} source\n${f.id}` : 'Nothing selected';
  $('fps').value = a?.fps || 12;
  $('loop').checked = a?.loop || false;
  $('scrub').max = Math.max(0, (a?.frames.length || 1) - 1);
  $('scrub').value = state.index;
  if (!f) return;
  $('frame-name').value = f.name;
  for (const [id, key] of [['offset-x', 'x'], ['offset-y', 'y'], ['scale', 'scale'], ['anchor-x', 'anchorX'], ['anchor-y', 'anchorY']]) $(id).value = f.transform[key];
  $('crop-width').value = f.width;
  $('crop-height').value = f.height;
}
function ids() {
  return $('scope').value === 'animation' ? [...active().frames] : [...state.selected];
}
function num(id) {
  return Number($(id).value);
}
function bind(id, fn) {
  $(id).onclick = fn;
}
bind('create', () => work(async () => {
  const result = await api('/api/projects', {
    name: $('project-name').value || 'Untitled character'
  });
  state.key = result.key;
  state.selected.clear();
  await adopt(result.project);
  await listProjects();
}, 'Project created. Import frames to begin.'));
$('projects').onchange = () => work(async () => {
  state.key = $('projects').value;
  state.selected.clear();
  state.reference = null;
  if (state.key) await refresh();else {
    state.project = null;
    location.href = location.pathname;
  }
}, 'Project opened.');
bind('import-catalog', () => work(async () => {
  await adopt(await api(endpoint('/catalog'), {
    revision: state.project.revision,
    catalogId: $('catalog').value
  }));
}, 'Character imported. Review mappings and normalize when ready.'));
function upload(files, options) {
  return work(async () => {
    const form = new FormData();
    [...files].forEach(f => form.append('files', f));
    form.append('revision', state.project.revision);
    form.append('options', JSON.stringify(options));
    await adopt(await api(endpoint('/import'), form));
  }, 'Imported. Original source files retained.');
}
bind('import-files', () => upload($('sources').files, {
  kind: $('import-kind').value,
  animation: $('import-animation').value,
  width: num('grid-width'),
  height: num('grid-height'),
  rows: $('grid-rows').value ? $('grid-rows').value.split(',').map(s => s.trim()) : undefined,
  extractFps: num('extract-fps')
}));
$('replacement').onchange = () => {
  if (current() && $('replacement').files.length) upload($('replacement').files, {
    replace: current().id
  });
};
bind('normalize', () => apply([{
  op: 'normalize'
}]));
bind('undo', () => apply([{
  op: 'undo'
}]));
bind('redo', () => apply([{
  op: 'redo'
}]));
bind('duplicate', () => apply([{
  op: 'duplicate',
  ids: ids()
}]));
bind('delete', () => apply([{
  op: 'delete',
  ids: ids()
}]));
bind('blank', () => apply([{
  op: 'blank',
  animation: state.animation,
  index: current() ? state.index + 1 : 0
}]));
bind('portrait', () => current() && apply([{
  op: 'portrait',
  ids: [current().id]
}]));
bind('rename', () => current() && apply([{
  op: 'rename',
  ids: [current().id],
  name: $('frame-name').value
}]));
bind('timing', () => apply([{
  op: 'animation',
  animation: state.animation,
  fps: num('fps'),
  loop: $('loop').checked
}]));
bind('add-animation', () => apply([{
  op: 'animation',
  animation: $('new-animation').value.trim()
}]));
bind('assign', () => apply([{
  op: 'assign',
  ids: ids(),
  to: $('assign-to').value
}]));
bind('transform', () => apply([{
  op: 'transform',
  ids: ids(),
  x: num('offset-x'),
  y: num('offset-y'),
  scale: num('scale'),
  anchorX: num('anchor-x'),
  anchorY: num('anchor-y')
}]));
bind('key', () => apply([{
  op: 'key',
  ids: ids(),
  color: $('color').value,
  tolerance: num('tolerance')
}]));
bind('crop', () => apply([{
  op: 'crop',
  ids: ids(),
  x: num('crop-x'),
  y: num('crop-y'),
  width: num('crop-width'),
  height: num('crop-height')
}]));
function step(delta) {
  if (active()?.frames.length) select(state.animation, (state.index + delta + active().frames.length) % active().frames.length);
}
bind('previous', () => step(-1));
bind('next', () => step(1));
bind('play', () => {
  if (!active()?.frames.length) return;
  $('tool').value = 'inspect';
  state.transition = null;
  state.playing = !state.playing;
  state.elapsed = 0;
  if (!state.playing) select(state.animation, state.index);
});
$('scrub').oninput = () => select(state.animation, num('scrub'));
bind('pin', () => {
  state.reference = current()?.id;
  $('compare').value = 'reference';
});
bind('play-transition', () => {
  if (!active()?.frames.length || !$('transition').value) return;
  state.index = 0;
  state.elapsed = 0;
  state.transition = $('transition').value;
  state.playing = true;
  $('tool').value = 'inspect';
});
$('tool').onchange = () => {
  state.playing = false;
};
for (const command of ['validate', 'render', 'export']) bind(command, () => work(async () => {
  status(command === 'render' ? 'Rendering contact sheets and animations…' : 'Analyzing project…');
  const result = await api(endpoint(command === 'validate' ? '/validate' : `/${command}`), command === 'validate' ? undefined : {
    frame: current()?.id
  });
  $('report').textContent = JSON.stringify(result.report || result, null, 2);
  $('artifacts').replaceChildren();
  for (const item of result.urls || []) {
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = item.file;
    $('artifacts').append(link);
  }
}, `${command === 'validate' ? 'Analysis' : command === 'render' ? 'Review pack' : 'Export'} ready.`));
function draw(ctx, id, native = false, alpha = 1) {
  const img = imageFor(id, native);
  if (!img?.complete || !img.naturalWidth) return;
  const scale = Math.min(420 / img.naturalWidth, 420 / img.naturalHeight) * num('zoom');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(256, 256);
  if (!native && $('flip').checked) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.restore();
}
function drawStage(canvas, id, native, onion = false) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  if (onion && active()?.frames.length > 1) {
    draw(ctx, active().frames[(state.index + active().frames.length - 1) % active().frames.length], false, .2);
    draw(ctx, active().frames[(state.index + 1) % active().frames.length], false, .2);
  }
  draw(ctx, id, native);
  if ($('guides').checked && !native) {
    ctx.strokeStyle = '#bdf16b80';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    const bottom = 256 + 210 * num('zoom');
    ctx.moveTo(0, bottom);
    ctx.lineTo(512, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (native && state.stroke) {
    const f = current(),
      scale = Math.min(420 / f.width, 420 / f.height) * num('zoom');
    ctx.fillStyle = $('tool').value === 'eraser' ? '#ff777799' : $('color').value;
    for (const [x, y] of state.stroke) {
      ctx.beginPath();
      ctx.arc(256 + (x - f.width / 2) * scale, 256 + (y - f.height / 2) * scale, num('radius') * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
let last = performance.now();
function tick(now) {
  const wasPlaying = state.playing;
  const delta = Math.min(100, now - last);
  last = now;
  if (state.playing && active()?.frames.length && !state.busy) {
    state.elapsed += delta * num('speed');
    const duration = 1000 / active().fps;
    while (state.elapsed >= duration && state.playing) {
      state.elapsed -= duration;
      state.index++;
      if (state.index >= active().frames.length) {
        if (state.transition) {
          state.animation = state.transition;
          state.transition = null;
          state.index = 0;
          if (!active().frames.length) state.playing = false;
        } else if (active().loop) state.index = 0;else {
          state.index = active().frames.length - 1;
          state.playing = false;
        }
      }
    }
  }
  if (wasPlaying && !state.playing) select(state.animation, state.index);
  const a = active(),
    f = current(),
    seam = $('compare').value === 'seam',
    native = $('tool').value !== 'inspect';
  $('play').textContent = state.playing ? 'Pause' : 'Play';
  $('position').textContent = `${f ? state.index + 1 : 0} / ${a?.frames.length || 0}`;
  $('scrub').value = state.index;
  $('frame-label').textContent = native ? `Original canvas · ${f?.name || 'No frame'}` : seam ? `${a?.key || ''} · last frame` : `${a?.key || ''} · ${f?.name || 'No frame'}`;
  $('comparison-wrap').hidden = $('compare').value === 'none';
  const bg = $('background').value;
  for (const id of ['stage', 'comparison-stage']) {
    $(id).classList.toggle('checker', bg === 'checker');
    $(id).style.backgroundColor = bg === 'checker' ? '' : bg;
  }
  drawStage($('canvas'), seam && !native ? a?.frames.at(-1) : f?.id, native, $('onion').checked && !native && !seam);
  if (!$('comparison-wrap').hidden) {
    drawStage($('comparison'), seam ? a?.frames[0] : state.reference, false);
    $('comparison-label').textContent = seam ? 'First frame · compare the loop seam' : `Reference · ${state.project?.frames[state.reference]?.name || 'Pin a frame'}`;
  }
  requestAnimationFrame(tick);
}
function point(event) {
  const f = current(),
    rect = $('canvas').getBoundingClientRect();
  if (!f) return null;
  const scale = Math.min(420 / f.width, 420 / f.height) * num('zoom');
  const x = ((event.clientX - rect.left) / rect.width * 512 - 256) / scale + f.width / 2;
  const y = ((event.clientY - rect.top) / rect.height * 512 - 256) / scale + f.height / 2;
  return x >= 0 && y >= 0 && x < f.width && y < f.height ? [x, y] : null;
}
$('canvas').onpointerdown = e => {
  if (state.busy || $('tool').value === 'inspect') return;
  const p = point(e);
  if (p) {
    state.playing = false;
    state.stroke = [p];
    $('canvas').setPointerCapture(e.pointerId);
  }
};
$('canvas').onpointermove = e => {
  if (!state.stroke) return;
  const p = point(e);
  if (p) {
    const prev = state.stroke.at(-1),
      distance = Math.hypot(p[0] - prev[0], p[1] - prev[1]),
      count = Math.ceil(distance / Math.max(.5, num('radius') / 2));
    for (let i = 1; i <= count && state.stroke.length < 20000; i++) state.stroke.push([prev[0] + (p[0] - prev[0]) * i / count, prev[1] + (p[1] - prev[1]) * i / count]);
  }
};
$('canvas').onpointerup = () => {
  if (!state.stroke || state.busy) return;
  const points = state.stroke;
  state.stroke = null;
  apply([{
    op: 'paint',
    ids: ids(),
    points,
    color: $('color').value,
    radius: num('radius'),
    erase: $('tool').value === 'eraser'
  }]);
};
$('canvas').onpointercancel = () => {
  state.stroke = null;
};
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !state.project || state.busy) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    apply([{
      op: e.shiftKey ? 'redo' : 'undo'
    }]);
  } else if (e.code === 'Space') {
    e.preventDefault();
    $('play').click();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    step(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    step(1);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    $('delete').click();
  }
});
setInterval(async () => {
  if (!state.key || state.busy || state.stroke || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  try {
    const p = await api(endpoint());
    if (p.revision !== state.project.revision) {
      state.playing = false;
      await adopt(p);
      status(`Updated from disk · revision ${p.revision}`);
    }
  } catch (e) {
    status(e.message, true);
  }
}, 2000);
(async () => {
  try {
    const entries = await api('/api/catalog');
    $('catalog').replaceChildren(...entries.map(i => option(i.id, i.label)));
    const params = new URLSearchParams(location.search);
    state.key = params.get('project') || '';
    state.animation = params.get('animation') || 'idle';
    await listProjects();
    if (state.key) {
      await refresh();
      const index = active().frames.indexOf(params.get('frame'));
      if (index >= 0) select(state.animation, index);
    }
  } catch (e) {
    status(e.message, true);
  }
  controls();
  requestAnimationFrame(tick);
})();
