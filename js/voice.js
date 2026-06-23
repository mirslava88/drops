// voice.js — синтез русской речи через Web Speech API.
// Звук идёт в текущее аудиоустройство телефона, т.е. в подключённые наушники.

let voices = [];
let enabled = true;
let rate = 1;

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

export function supported() {
  return 'speechSynthesis' in window;
}

// Лучший доступный русский голос (или null — тогда браузер выберет сам).
function ruVoice() {
  return (
    voices.find((v) => /^ru([-_]|$)/i.test(v.lang)) ||
    voices.find((v) => /ru/i.test(v.lang)) ||
    null
  );
}

export function setEnabled(v) {
  enabled = !!v;
  if (!enabled && supported()) speechSynthesis.cancel();
}

export function setRate(r) {
  rate = r;
}

// «Разбудить» движок: в некоторых браузерах очередь зависает в paused.
function wake() {
  try {
    if (speechSynthesis.paused) speechSynthesis.resume();
  } catch {
    /* игнорируем */
  }
}

// Озвучить текст. priority=true прерывает текущую речь (для срочных команд).
export function speak(text, { priority = false } = {}) {
  if (!enabled || !supported() || !text) return;
  if (priority) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  u.rate = rate;
  const v = ruVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  wake();
}

// Короткая «проверка звука» — её удобно жать перед стартом,
// заодно это user gesture, разблокирующий синтез на мобильных.
export function test() {
  speak('Навигатор готов. Звук идёт в наушники.', { priority: true });
}
