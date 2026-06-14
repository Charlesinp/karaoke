'use strict';

let player       = null;
let countTimer   = null;
let confettiRAF  = null;
let particles    = [];
let pendingCmd   = null;
let audioEnabled = false;
let nearEndFired = false;

// ── Mensajes desde el panel de control ────────────────────────────────────
window.addEventListener('message', (e) => {
  // Acepta solo mensajes del opener (panel de control)
  if (window.opener && e.source !== window.opener) return;
  handle(e.data);
});

function handle(data) {
  // El player de YouTube aún no está listo: guarda el comando para ejecutarlo
  // en cuanto termine de inicializarse.
  if (!player) { pendingCmd = data; return; }

  switch (data.type) {
    case 'play':
      hideScore();
      hideWaiting();
      nearEndFired = false;
      player.loadVideoById(data.videoId);
      player.playVideo();
      break;
    case 'pause':
      if (player) player.pauseVideo();
      break;
    case 'resume':
      if (player) player.playVideo();
      break;
    case 'stop':
      if (player) player.stopVideo();
      showWaiting();
      break;
    case 'show_score':
      showScore(data.score, data.singer, data.title);
      break;
    case 'update_score':
      updateScore(data.score, data.singer, data.title);
      break;
    case 'hide_score':
      hideScore();
      break;
    case 'idle':
      showWaiting();
      break;
  }
}

// ── YouTube IFrame API ─────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    videoId: '',
    playerVars: {
      autoplay:      1,
      mute:          1,
      controls:      0,
      disablekb:     1,
      fs:            0,
      modestbranding:1,
      rel:           0,
      iv_load_policy:3,
      cc_load_policy:0,
      playsinline:   1,
    },
    events: {
      onReady() {
        if (window.opener) window.opener.postMessage({ type: 'projection_ready' }, '*');
        if (pendingCmd) { const cmd = pendingCmd; pendingCmd = null; handle(cmd); }
      },
      onStateChange(e) {
        if (e.data === YT.PlayerState.ENDED) {
          showWaiting();
          if (window.opener) window.opener.postMessage({ type: 'song_ended' }, '*');
        }
      },
    },
  });
};

// ── Activar sonido (requiere un clic real en esta ventana) ────────────────
function enableAudio() {
  audioEnabled = true;
  document.getElementById('unmute-btn').classList.add('hidden');
  if (player) {
    player.unMute();
    player.setVolume(100);
  }
}

// ── Detección de "últimos 5 segundos" ──────────────────────────────────────
setInterval(() => {
  if (!player || typeof player.getPlayerState !== 'function') return;
  if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;

  const dur = player.getDuration();
  const cur = player.getCurrentTime();
  if (dur > 0 && dur - cur <= 5 && !nearEndFired) {
    nearEndFired = true;
    if (window.opener) window.opener.postMessage({ type: 'near_end' }, '*');
  }
}, 500);

// ── Pantallas ──────────────────────────────────────────────────────────────
function showWaiting() {
  document.getElementById('waiting').classList.remove('hidden');
  document.getElementById('player-wrap').classList.add('dim');
}

function hideWaiting() {
  document.getElementById('waiting').classList.add('hidden');
  document.getElementById('player-wrap').classList.remove('dim');
}

// ── Puntaje ────────────────────────────────────────────────────────────────
function showScore(score, singer, title) {
  clearInterval(countTimer);
  stopConfetti();

  document.getElementById('player-wrap').classList.add('blurred');

  const ov      = document.getElementById('score-ov');
  const numEl   = document.getElementById('s-num');
  const starsEl = document.getElementById('s-stars');
  const singerEl= document.getElementById('s-singer');
  const titleEl = document.getElementById('s-title');

  // Reset
  numEl.className   = 's-num';
  numEl.textContent = '0';
  starsEl.textContent = '';
  singerEl.textContent = singer || '';
  titleEl.textContent  = title  || '';

  ov.classList.remove('hidden');

  // Animación de conteo ascendente (1.6 s)
  const steps    = 72;
  const interval = 1600 / steps;
  const inc      = score / steps;
  let current    = 0;

  countTimer = setInterval(() => {
    current = Math.min(current + inc, score);
    numEl.textContent = Math.round(current);

    if (current >= score) {
      clearInterval(countTimer);
      numEl.textContent = score;

      // Color según puntaje
      if      (score >= 90) numEl.classList.add('excellent');
      else if (score >= 70) numEl.classList.add('good');
      else if (score >= 50) numEl.classList.add('ok');
      else                   numEl.classList.add('poor');

      // Estrellas (0–5)
      const stars = Math.round(score / 20);
      starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);

      // Confetti si puntaje alto
      if (score >= 70) launchConfetti();
    }
  }, interval);
}

function hideScore() {
  clearInterval(countTimer);
  stopConfetti();
  document.getElementById('score-ov').classList.add('hidden');
  document.getElementById('player-wrap').classList.remove('blurred');
}

// ── Actualiza el puntaje ya mostrado sin re-animar (datos en vivo) ──────────
function updateScore(score, singer, title) {
  const ov = document.getElementById('score-ov');
  if (ov.classList.contains('hidden')) {
    showScore(score, singer, title);
    return;
  }

  clearInterval(countTimer);
  const numEl   = document.getElementById('s-num');
  const starsEl = document.getElementById('s-stars');

  document.getElementById('s-singer').textContent = singer || '';
  document.getElementById('s-title').textContent  = title  || '';

  numEl.textContent = score;
  numEl.className   = 's-num';
  if      (score >= 90) numEl.classList.add('excellent');
  else if (score >= 70) numEl.classList.add('good');
  else if (score >= 50) numEl.classList.add('ok');
  else                   numEl.classList.add('poor');

  const stars = Math.max(0, Math.min(5, Math.round(score / 20)));
  starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);

  if (score >= 70) {
    if (!particles.length) launchConfetti();
  } else {
    stopConfetti();
  }
}

// ── Confetti ───────────────────────────────────────────────────────────────
const COLORS = ['#7c4dff','#e040fb','#ffd740','#00e676','#40c4ff','#ff5252','#fff'];

function launchConfetti() {
  const canvas = document.getElementById('fireworks');
  const W = canvas.width  = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  particles = [];
  for (let i = 0; i < 180; i++) {
    particles.push({
      x:  Math.random() * W,
      y:  -20 - Math.random() * 200,
      vx: (Math.random() - .5) * 6,
      vy: 2 + Math.random() * 5,
      w:  6 + Math.random() * 8,
      h:  4 + Math.random() * 6,
      rot:Math.random() * Math.PI * 2,
      dr: (Math.random() - .5) * .2,
      col:COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1,
    });
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += .12;        // gravedad
      p.rot += p.dr;
      p.life -= .004;

      if (p.y < H + 20 && p.life > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    if (alive) confettiRAF = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }

  confettiRAF = requestAnimationFrame(frame);
}

function stopConfetti() {
  if (confettiRAF) cancelAnimationFrame(confettiRAF);
  const canvas = document.getElementById('fireworks');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = [];
}
