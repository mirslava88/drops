// app.js — связываем UI, геолокацию, движок навигации и озвучку.

import * as routing from './routing.js';
import * as voice from './voice.js';
import * as storage from './storage.js';
import { NavEngine } from './nav.js';

const $ = (id) => document.getElementById(id);

const ui = {
  dest: $('dest'),
  mic: $('mic'),
  go: $('go'),
  stop: $('stop'),
  testVoice: $('testVoice'),
  profile: $('profile'),
  voiceOn: $('voiceOn'),
  rate: $('rate'),
  yandexKey: $('yandexKey'),
  status: $('status'),
  instruction: $('instruction'),
  distToManeuver: $('distToManeuver'),
  remaining: $('remaining'),
  eta: $('eta'),
  accuracy: $('accuracy'),
  card: $('card'),
};

let settings = storage.load();
let engine = null;
let watchId = null;
let wakeLock = null;
let destination = null; // { lat, lng, label }
let lastPos = null;
let navigating = false;

// ---------- настройки ----------
function applySettings() {
  ui.profile.value = settings.profile;
  ui.voiceOn.checked = settings.voice;
  ui.rate.value = settings.rate;
  ui.yandexKey.value = settings.yandexKey;
  voice.setEnabled(settings.voice);
  voice.setRate(parseFloat(settings.rate) || 1);
}
function saveFromUI() {
  settings.profile = ui.profile.value;
  settings.voice = ui.voiceOn.checked;
  settings.rate = parseFloat(ui.rate.value) || 1;
  settings.yandexKey = ui.yandexKey.value.trim();
  storage.save(settings);
  voice.setEnabled(settings.voice);
  voice.setRate(settings.rate);
}
['change', 'input'].forEach((ev) => {
  [ui.profile, ui.voiceOn, ui.rate, ui.yandexKey].forEach((el) =>
    el.addEventListener(ev, saveFromUI)
  );
});

function setStatus(msg, kind = '') {
  ui.status.textContent = msg;
  ui.status.className = 'status ' + kind;
}

// ---------- геолокация ----------
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Геолокация не поддерживается'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toPos(p)),
      (e) => reject(new Error(geoError(e))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
  });
}
function toPos(p) {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    speed: p.coords.speed, // м/с или null
    heading: p.coords.heading,
  };
}
function geoError(e) {
  if (e.code === 1) return 'Нет доступа к геолокации. Разрешите его в браузере.';
  if (e.code === 2) return 'Позиция недоступна. Проверьте GPS/сеть.';
  if (e.code === 3) return 'Таймаут получения позиции.';
  return e.message || 'Ошибка геолокации';
}

// ---------- поиск пункта назначения ----------
async function resolveDestination() {
  const q = ui.dest.value.trim();
  if (!q) throw new Error('Введите адрес назначения');
  setStatus('Ищу адрес…');
  const opts = settings.yandexKey ? { yandexKey: settings.yandexKey } : {};
  const d = await routing.geocode(q, opts);
  destination = d;
  setStatus('Найдено: ' + d.label, 'ok');
  return d;
}

// ---------- построение маршрута ----------
async function buildRoute(from) {
  const opts = { profile: settings.profile, osrmUrl: settings.osrmUrl };
  return routing.route(from, destination, opts);
}

// ---------- старт навигации ----------
async function start() {
  try {
    ui.go.disabled = true;
    if (!destination) await resolveDestination();

    setStatus('Определяю местоположение…');
    const from = await currentPosition();
    lastPos = from;

    setStatus('Строю маршрут…');
    const route = await buildRoute(from);

    engine = new NavEngine(route, settings.profile);
    wireEngine();

    navigating = true;
    ui.card.classList.remove('hidden');
    ui.stop.classList.remove('hidden');
    ui.go.classList.add('hidden');

    voice.speak(`Маршрут построен. ${routing.humanDistance(route.distance)} до цели. Поехали.`, {
      priority: true,
    });
    setStatus('В пути', 'ok');

    await keepAwake();
    startWatch();
    // Сразу прогоняем первую позицию через движок.
    engine.update(from);
  } catch (e) {
    setStatus(e.message, 'err');
    voice.speak('Не получилось. ' + e.message);
  } finally {
    ui.go.disabled = false;
  }
}

function wireEngine() {
  engine.onInstruction = (text) => {
    ui.instruction.textContent = text;
    voice.speak(text);
  };
  engine.onProgress = (p) => {
    ui.instruction.textContent = p.instruction;
    ui.distToManeuver.textContent = p.distToManeuverText;
    ui.remaining.textContent = p.remainingText;
    ui.eta.textContent = fmtEta(p.eta);
    ui.card.classList.toggle('offroute', p.offRoute);
  };
  engine.onArrive = () => {
    setStatus('Вы на месте 🎉', 'ok');
    stop(false);
  };
  engine.onReroute = async (pos) => {
    setStatus('Сошли с маршрута — пересчитываю…', 'warn');
    voice.speak('Пересчитываю маршрут', { priority: true });
    try {
      const route = await buildRoute(pos);
      engine.setRoute(route);
      setStatus('В пути', 'ok');
    } catch (e) {
      setStatus('Не удалось пересчитать: ' + e.message, 'err');
    }
  };
}

function startWatch() {
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      lastPos = toPos(p);
      ui.accuracy.textContent = lastPos.accuracy ? Math.round(lastPos.accuracy) + ' м' : '—';
      if (engine && navigating) engine.update(lastPos);
    },
    (e) => setStatus(geoError(e), 'warn'),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
  );
}

function stop(announce = true) {
  navigating = false;
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  releaseWake();
  ui.stop.classList.add('hidden');
  ui.go.classList.remove('hidden');
  if (announce) {
    setStatus('Навигация остановлена');
    voice.speak('Навигация остановлена', { priority: true });
  }
}

// ---------- не давать экрану гаснуть ----------
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      // Браузер сам снимает блокировку, когда экран гаснет/вкладка скрыта;
      // обнуляем ссылку, чтобы visibilitychange смог запросить её заново.
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
  } catch {
    /* не критично */
  }
}
function releaseWake() {
  try {
    wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigating && !wakeLock) keepAwake();
});

// ---------- голосовой ввод адреса (бонус) ----------
function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    ui.mic.classList.add('hidden');
    return;
  }
  ui.mic.addEventListener('click', () => {
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setStatus('Говорите адрес…');
    rec.onresult = (e) => {
      ui.dest.value = e.results[0][0].transcript;
      resolveDestination().catch((err) => setStatus(err.message, 'err'));
    };
    rec.onerror = () => setStatus('Не расслышал, попробуйте ещё раз', 'warn');
    rec.start();
  });
}

// ---------- утилиты ----------
function fmtEta(sec) {
  if (!isFinite(sec)) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' мин';
  return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
}

// ---------- инициализация ----------
applySettings();
setupMic();
ui.go.addEventListener('click', start);
ui.stop.addEventListener('click', () => stop(true));
ui.testVoice.addEventListener('click', () => voice.test());
ui.dest.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') resolveDestination().catch((err) => setStatus(err.message, 'err'));
});

if (!voice.supported()) setStatus('В этом браузере нет синтеза речи — подсказки будут только на экране', 'warn');

// Service worker (только по http/https, не по file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
