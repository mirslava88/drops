// storage.js — настройки в localStorage.

const KEY = 'drops-nav-settings';

const defaults = {
  profile: 'driving', // driving | foot | bike
  voice: true,
  rate: 1,
  yandexKey: '',
  osrmUrl: '', // пусто → публичный демо-сервер OSRM
};

export function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}
