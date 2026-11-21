const STORAGE_KEY = 'digalo:v1';
const MOVIES_URL = 'movies.json';
const HISTORY_SIZE = 5;
// Seconds on the clock for each turn. 0 hides the clock.
const TURN_SECONDS = [0, 30, 60, 90, 120];
const DEFAULT_SECONDS = 60;
// The picker value for "movies of every level". The level ids come from movies.json.
const ALL_LEVELS = 'all';
const DEFAULT_LEVEL = 'easy';
// The clock turns gold and ticks during the last seconds.
const ENDING_SECONDS = 5;

const els = {
  card: document.getElementById('card'),
  hint: document.getElementById('hint'),
  title: document.getElementById('title'),
  clock: document.getElementById('clock'),
  status: document.getElementById('status'),
  actions: document.querySelector('.actions'),
  draw: document.getElementById('draw'),
  timer: document.getElementById('timer'),
  historyWrap: document.getElementById('history-wrap'),
  history: document.getElementById('history'),
  mute: document.getElementById('mute'),
  level: document.getElementById('level'),
  seconds: document.getElementById('seconds'),
  reset: document.getElementById('reset'),
};

// From movies.json: [{ id, name, movies: [title…] }], from the best-known movies to the niche ones.
let levels = [];
let moviesFailed = false;
let state = load();
// The title starts covered after every draw and every reload, so only the actor sees it.
let shown = false;
// Clock: the time it ends at (ms), the interval that redraws it, and whether it reached zero.
let clockEnd = 0;
let clockTimer = null;
let clockLeft = 0;
let timeUp = false;
let wakeLock = null;
let wakeLockPending = false;

// --- State -----------------------------------------------------------------

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.drawn)) {
      return {
        // Titles, not positions, so the saved game survives an edit of movies.json.
        drawn: [...new Set(saved.drawn.filter((title) => typeof title === 'string'))],
        muted: Boolean(saved.muted),
        seconds: TURN_SECONDS.includes(saved.seconds) ? saved.seconds : DEFAULT_SECONDS,
        level: typeof saved.level === 'string' ? saved.level : DEFAULT_LEVEL,
      };
    }
  } catch {
    // Storage blocked or corrupt.
  }
  return null;
}

function load() {
  return readSaved() ?? { drawn: [], muted: false, seconds: DEFAULT_SECONDS, level: DEFAULT_LEVEL };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the game still works, it just won't survive a reload.
  }
}

// Another tab with the same game may have drawn movies; adopt its state so we never repeat one.
function syncFromStorage() {
  const saved = readSaved();
  if (!saved) return;
  if (saved.drawn.at(-1) !== state.drawn.at(-1)) {
    shown = false;
    stopClock();
  }
  state = saved;
  render();
}

// The movies of the picked level, or of every level.
function levelMovies() {
  const picked = levels.filter((level) => state.level === ALL_LEVELS || level.id === state.level);
  return picked.flatMap((level) => level.movies);
}

function remaining() {
  const drawn = new Set(state.drawn);
  return levelMovies().filter((title) => !drawn.has(title));
}

function randomIndex(length) {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return value % length;
}

async function loadMovies() {
  try {
    const response = await fetch(MOVIES_URL);
    const data = await response.json();
    levels = data.levels
      .map(({ id, name, movies }) => ({
        id: String(id),
        name: String(name),
        movies: [...new Set(movies.filter((title) => typeof title === 'string' && title.trim()))],
      }))
      .filter((level) => level.movies.length);
    if (!levels.length) throw new Error('empty');
    els.level.replaceChildren(
      ...levels.map((level) => new Option(level.name, level.id)),
      new Option('Todas', ALL_LEVELS),
    );
    // A saved level that movies.json no longer has falls back to the first one.
    if (state.level !== ALL_LEVELS && !levels.some((level) => level.id === state.level)) state.level = levels[0].id;
  } catch {
    levels = [];
    moviesFailed = true;
  }
  render();
}

// --- Screen wake lock --------------------------------------------------------

async function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock || wakeLockPending) return;
  wakeLockPending = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    // Denied (for example, battery saver): the screen may dim, nothing else breaks.
  } finally {
    wakeLockPending = false;
  }
}

// --- Sound effects ---------------------------------------------------------------
// Made in the browser with Web Audio, so there are no audio files. They follow «Sonido» on/off.

let audio = null;

// iOS only starts audio inside a tap, so this runs on every tap. After the first one it does nothing.
function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audio ??= new AudioContextClass();
  if (audio.state !== 'running') audio.resume().catch(() => {});
}

function canPlaySound() {
  return audio?.state === 'running' && !state.muted;
}

function tone(type, freq, start, length, volume, endFreq = freq) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

// One short tick for each of the last seconds.
function tick() {
  if (!canPlaySound()) return;
  tone('triangle', 880, audio.currentTime, 0.08, 0.2);
}

// A falling buzzer when the time is up.
function buzzer() {
  if (canPlaySound()) {
    const start = audio.currentTime + 0.02;
    tone('sawtooth', 320, start, 0.35, 0.16, 150);
    tone('sawtooth', 300, start + 0.4, 0.7, 0.16, 90);
  }
  if (!state.muted) navigator.vibrate?.([200, 100, 400]);
}

// --- Clock -------------------------------------------------------------------

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
  timeUp = false;
}

function updateClock() {
  const left = Math.max(0, Math.ceil((clockEnd - Date.now()) / 1000));
  if (left === clockLeft) return;
  clockLeft = left;
  if (left === 0) {
    stopClock();
    timeUp = true;
    buzzer();
  } else if (left <= ENDING_SECONDS) {
    tick();
  }
  render();
}

function startClock() {
  stopClock();
  clockLeft = state.seconds;
  clockEnd = Date.now() + state.seconds * 1000;
  // Faster than once a second, so the display never skips or lags a second.
  clockTimer = setInterval(updateClock, 200);
  keepAwake();
  render();
}

function formatClock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// --- Game ------------------------------------------------------------------

function draw() {
  const pool = remaining();
  if (!pool.length) return;
  if (!state.drawn.length) window.track('game_start', { seconds: state.seconds, level: state.level });
  state.drawn.push(pool[randomIndex(pool.length)]);
  shown = false;
  stopClock();
  save();
  keepAwake();
  render();
}

function newGame() {
  state.drawn = [];
  shown = false;
  stopClock();
  save();
  render();
}

// --- Render ------------------------------------------------------------------

function statusText(current, left) {
  if (moviesFailed) return 'No se pudieron cargar las películas. Recargá la página.';
  if (!levels.length) return 'Cargando películas…';
  if (timeUp) return '¡Tiempo!';
  if (!left) return 'Ya salieron todas las películas de esta dificultad. Cambiala o empezá un juego nuevo.';
  if (!current) return 'Actuá la película sin hablar. Tu equipo tiene que adivinarla.';
  return `Película ${state.drawn.length} · quedan ${left}`;
}

function hintText(current) {
  if (!current) return 'Sacá una película';
  return 'Tocá para ver la película. Que no la vea nadie más.';
}

function render() {
  const current = state.drawn.at(-1) ?? '';
  const left = remaining().length;
  const running = clockTimer !== null;

  els.card.disabled = !current;
  els.card.classList.toggle('shown', shown);
  els.card.setAttribute('aria-pressed', String(shown));
  els.hint.hidden = shown;
  els.hint.textContent = hintText(current);
  els.title.hidden = !shown;
  els.title.textContent = shown ? current : '';

  els.clock.hidden = !running && !timeUp;
  els.clock.textContent = formatClock(timeUp ? 0 : clockLeft);
  els.clock.classList.toggle('ending', timeUp || clockLeft <= ENDING_SECONDS);
  els.status.textContent = statusText(current, left);

  els.draw.disabled = !left;
  els.draw.textContent = current ? 'Otra película' : 'Sacar película';
  els.timer.hidden = state.seconds === 0;
  els.timer.disabled = !current;
  els.timer.textContent = running ? '■ Parar' : '⏱ Empezar';

  const previous = state.drawn.slice(0, -1).slice(-HISTORY_SIZE).reverse();
  els.historyWrap.hidden = !previous.length;
  els.history.replaceChildren(...previous.map((title) => {
    const item = document.createElement('li');
    item.textContent = title;
    return item;
  }));

  els.mute.setAttribute('aria-pressed', String(!state.muted));
  els.mute.textContent = state.muted ? '🔇 Sonido' : '🔊 Sonido';
  els.seconds.value = String(state.seconds);
  els.level.value = state.level;
  els.reset.disabled = !state.drawn.length;
}

// --- Events ------------------------------------------------------------------

els.draw.addEventListener('click', draw);

els.card.addEventListener('click', () => {
  shown = !shown;
  render();
});

els.timer.addEventListener('click', () => {
  if (clockTimer === null) startClock();
  else stopClock();
  render();
});

els.mute.addEventListener('click', () => {
  state.muted = !state.muted;
  save();
  render();
});

// A change of level keeps the movies that already came out, so none repeats if the level changes back.
els.level.addEventListener('change', () => {
  state.level = els.level.value;
  save();
  render();
});

els.seconds.addEventListener('change', () => {
  state.seconds = Number(els.seconds.value);
  stopClock();
  save();
  render();
});

els.reset.addEventListener('click', () => {
  if (window.confirm('¿Empezar un juego nuevo? Las películas que salieron pueden volver a salir.')) newGame();
});

// Capture phase, so the audio is unlocked before the button's own handler needs it.
document.addEventListener('click', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return;
  if (event.target.closest?.('button, select, input, a')) return;
  event.preventDefault();
  draw();
});

// Ask for the wake lock on the first touch too, so the screen stays on before the first draw.
document.addEventListener('pointerdown', keepAwake, { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Cover the title, so it is not on screen when the phone is unlocked in front of the team.
    shown = false;
    render();
    return;
  }
  syncFromStorage();
  if (state.drawn.length) keepAwake();
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) syncFromStorage();
});

// Keep the page padding in step with the real height of the bottom bar (large text, safe areas).
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--bar-height', `${els.actions.offsetHeight}px`);
}).observe(els.actions);

els.seconds.append(...TURN_SECONDS.map((seconds) => new Option(seconds ? `${seconds} segundos` : 'Sin reloj', seconds)));

// Offline support for the deployed site. Skipped on localhost so it never caches other local dev servers.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
loadMovies();
