'use strict';

// ── Estado global ──────────────────────────────────────────────────────────
const DEFAULT_API_KEY = 'AIzaSyDi8zLuPCilYSnQDjYkBGAugugvDfWfDZQ';

let queue        = [];
let currentIdx   = -1;
let playState    = 'idle';   // idle | playing | paused | ended
let apiKey       = localStorage.getItem('yt_api_key') || DEFAULT_API_KEY;
let projWin      = null;
let searchItems  = [];
let autoShown    = false;    // ¿ya se mostró el puntaje para la canción actual?
let autoAdvanceTimer = null; // temporizador para pasar a la siguiente canción

// ── Inicialización ─────────────────────────────────────────────────────────
document.getElementById('apikey').value = apiKey;
renderQueue();

if (location.protocol === 'file:') {
  document.getElementById('file-notice').style.display = 'block';
}

window.addEventListener('message', (e) => {
  if (e.source !== projWin) return;
  const { type } = e.data;
  if (type === 'projection_ready') setStatus(true);
  if (type === 'song_ended')       onSongEnded();
  if (type === 'near_end')         onNearEnd();
});

document.getElementById('singer').addEventListener('input', () => {
  if (autoShown) sendUpdate();
});
document.getElementById('score').addEventListener('input', () => {
  if (autoShown) sendUpdate();
});

// ── Proyección ─────────────────────────────────────────────────────────────
function openProjection() {
  if (projWin && !projWin.closed) { projWin.focus(); return; }
  projWin = window.open(
    'projection.html', 'kp',
    'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
  );
  setStatus(false);
}

// Detecta si la ventana de proyección se cerró, para actualizar el indicador.
setInterval(() => {
  if (projWin && projWin.closed) {
    projWin = null;
    setStatus(false);
  }
}, 1000);

function send(data) {
  if (projWin && !projWin.closed) projWin.postMessage(data, '*');
}

function setStatus(online) {
  const el = document.getElementById('proj-status');
  el.textContent = online ? '🟢 Proyección conectada' : '⚫ Proyección';
  el.classList.toggle('online', online);
}

// ── API Key ────────────────────────────────────────────────────────────────
function saveApiKey() {
  apiKey = document.getElementById('apikey').value.trim();
  localStorage.setItem('yt_api_key', apiKey);
  toast('API key guardada', 'ok');
}

// ── Búsqueda YouTube ───────────────────────────────────────────────────────
async function doSearch() {
  const q = document.getElementById('q').value.trim();
  if (!q) return;

  if (!apiKey) { showMsg('Configura tu API key primero.', true); return; }

  showMsg('Buscando…');
  document.getElementById('results').innerHTML = '';
  searchItems = [];

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', q);
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '8');
    url.searchParams.set('key', apiKey);

    const r = await fetch(url);
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error?.message || `HTTP ${r.status}`);
    }
    const data = await r.json();
    searchItems = data.items || [];
    renderResults();
    showMsg(searchItems.length ? '' : 'Sin resultados.');
  } catch (e) {
    showMsg('Error: ' + e.message, true);
  }
}

function renderResults() {
  document.getElementById('results').innerHTML = searchItems.map((it, i) => `
    <div class="result-item">
      <img src="${it.snippet.thumbnails.default.url}" alt="" loading="lazy">
      <div class="result-info">
        <div class="result-title" title="${esc(it.snippet.title)}">${esc(it.snippet.title)}</div>
        <div class="result-channel">${esc(it.snippet.channelTitle)}</div>
      </div>
      <button class="btn-add" onclick="addSearchResult(${i})">+ Cola</button>
    </div>
  `).join('');
}

function addSearchResult(i) {
  const it = searchItems[i];
  addToQueue(it.id.videoId, it.snippet.title, it.snippet.thumbnails.default.url);
}

function showMsg(msg, isErr = false) {
  const el = document.getElementById('search-msg');
  el.textContent = msg;
  el.className = 'search-msg' + (isErr ? ' err' : '');
}

// ── Agregar por URL/ID ─────────────────────────────────────────────────────
async function addByUrl() {
  const val = document.getElementById('urlid').value.trim();
  if (!val) return;
  const id = extractId(val);
  if (!id) { toast('URL o ID inválido', 'err'); return; }

  document.getElementById('urlid').value = '';
  toast('Obteniendo info del video…');

  // oEmbed no necesita API key
  let title = id;
  let thumb = null;
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`
    );
    if (r.ok) {
      const d = await r.json();
      title = d.title;
      thumb = d.thumbnail_url;
    }
  } catch {}

  addToQueue(id, title, thumb);
}

function extractId(input) {
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {}
  return null;
}

// ── Cola ───────────────────────────────────────────────────────────────────
function addToQueue(videoId, title, thumbnail) {
  queue.push({ videoId, title: title || videoId, thumbnail: thumbnail || null });
  renderQueue();
  toast(`Agregado: ${title.slice(0, 45)}${title.length > 45 ? '…' : ''}`);
}

function removeFromQueue(i) {
  if (i === currentIdx) return;
  queue.splice(i, 1);
  if (i < currentIdx) currentIdx--;
  renderQueue();
}

function moveUp(i) {
  if (i <= 0 || i === currentIdx || i - 1 === currentIdx) return;
  [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
  renderQueue();
}

function moveDown(i) {
  if (i >= queue.length - 1 || i === currentIdx) return;
  [queue[i], queue[i + 1]] = [queue[i + 1], queue[i]];
  renderQueue();
}

function renderQueue() {
  document.getElementById('qcount').textContent = queue.length;
  const el = document.getElementById('qlist');

  if (!queue.length) {
    el.innerHTML = '<div class="q-empty">Cola vacía — busca o pega una URL para empezar</div>';
    document.getElementById('np').textContent = '— Nada —';
    return;
  }

  el.innerHTML = queue.map((item, i) => `
    <div class="q-item ${i === currentIdx ? 'current' : ''}">
      ${item.thumbnail
        ? `<img src="${item.thumbnail}" alt="">`
        : '<div class="q-thumb-blank"></div>'
      }
      <div class="q-info">
        <span class="q-num">${i + 1}.</span>
        <span class="q-title" title="${esc(item.title)}">${esc(item.title)}</span>
        ${i === currentIdx ? '<span class="badge-now">AHORA</span>' : ''}
      </div>
      ${i !== currentIdx ? `
        <div class="q-btns">
          <button onclick="moveUp(${i})" title="Subir">↑</button>
          <button onclick="moveDown(${i})" title="Bajar">↓</button>
          <button class="del" onclick="removeFromQueue(${i})" title="Quitar">✕</button>
        </div>
      ` : ''}
    </div>
  `).join('');

  if (currentIdx >= 0 && queue[currentIdx]) {
    document.getElementById('np').textContent = queue[currentIdx].title;
  } else {
    document.getElementById('np').textContent = '— Nada —';
  }
}

// ── Controles de reproducción ──────────────────────────────────────────────
function cmdPlay() {
  if (!projWin || projWin.closed) {
    toast('Abre la ventana de proyección primero', 'err');
    return;
  }
  if (!queue.length) { toast('La cola está vacía', 'err'); return; }

  if (playState === 'paused') {
    send({ type: 'resume' });
    playState = 'playing';
    return;
  }

  if (currentIdx === -1) currentIdx = 0;
  startVideo(currentIdx);
}

function cmdPause() {
  send({ type: 'pause' });
  playState = 'paused';
}

function cmdSkip() {
  if (currentIdx < queue.length - 1) {
    startVideo(currentIdx + 1);
  } else {
    toast('No hay más canciones en la cola');
  }
}

function cmdStop() {
  clearTimeout(autoAdvanceTimer);
  send({ type: 'stop' });
  send({ type: 'hide_score' });
  document.getElementById('score-panel').classList.add('hidden');
  autoShown = false;
  playState = 'idle';
}

function startVideo(idx) {
  clearTimeout(autoAdvanceTimer);
  currentIdx = idx;
  const item = queue[idx];
  send({ type: 'play', videoId: item.videoId, title: item.title });
  send({ type: 'hide_score' });
  playState = 'playing';
  autoShown = false;

  document.getElementById('score-song').textContent = item.title;
  document.getElementById('score').value  = '';
  document.getElementById('singer').value = '';
  document.getElementById('score-panel').classList.remove('hidden');

  renderQueue();
}

// ── Puntaje ─────────────────────────────────────────────────────────────────
function getScoreData() {
  const raw   = document.getElementById('score').value.trim();
  const score = raw === '' ? 0 : Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
  const singer = document.getElementById('singer').value.trim();
  const title  = (currentIdx >= 0 && queue[currentIdx]) ? queue[currentIdx].title : '';
  return { score, singer, title };
}

function sendUpdate() {
  send({ type: 'update_score', ...getScoreData() });
}

// ── A 5s del final → mostrar puntaje automáticamente ─────────────────────────
function onNearEnd() {
  if (autoShown) return;
  autoShown = true;
  send({ type: 'show_score', ...getScoreData() });
}

// ── Fin de canción (respaldo si near_end no se disparó) ──────────────────────
function onSongEnded() {
  playState = 'ended';
  if (!autoShown) {
    autoShown = true;
    send({ type: 'show_score', ...getScoreData() });
  }

  // Si hay más canciones en la cola, continúa automáticamente tras mostrar el puntaje.
  clearTimeout(autoAdvanceTimer);
  if (currentIdx < queue.length - 1) {
    autoAdvanceTimer = setTimeout(() => cmdNext(), 6000);
  }
}

function cmdShowScore() {
  const score = parseInt(document.getElementById('score').value, 10);
  if (isNaN(score) || score < 0 || score > 100) {
    toast('Ingresa un número entre 0 y 100', 'err');
    return;
  }
  const singer = document.getElementById('singer').value.trim();
  const title  = (currentIdx >= 0 && queue[currentIdx]) ? queue[currentIdx].title : '';
  autoShown = true;
  send({ type: 'show_score', score, singer, title });
}

function cmdNext() {
  clearTimeout(autoAdvanceTimer);
  send({ type: 'hide_score' });
  document.getElementById('score-panel').classList.add('hidden');
  autoShown = false;

  if (currentIdx < queue.length - 1) {
    startVideo(currentIdx + 1);
  } else {
    toast('¡Cola terminada! 🎉');
    currentIdx = -1;
    playState  = 'idle';
    send({ type: 'idle' });
    renderQueue();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 280);
  }, 3000);
}
