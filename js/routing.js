// routing.js — геокодирование (адрес → координаты) и построение маршрута
// с пошаговыми манёврами. По умолчанию бесплатные сервисы без ключа:
//   геокодер — Nominatim (OpenStreetMap), маршрут — публичный OSRM.
// При наличии ключа Яндекса используется Яндекс.Геокодер.

import { instructionText } from './instructions.js';
import { cumulative, haversine } from './geo.js';

// Адрес/запрос → { lat, lng, label }.
export async function geocode(query, opts = {}) {
  if (opts.yandexKey) {
    const url =
      `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(opts.yandexKey)}` +
      `&geocode=${encodeURIComponent(query)}&format=json&lang=ru_RU&results=1`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Яндекс.Геокодер вернул ошибку ' + r.status);
    const j = await r.json();
    const m = j.response?.GeoObjectCollection?.featureMember?.[0];
    if (!m) throw new Error('Адрес не найден');
    const [lng, lat] = m.GeoObject.Point.pos.split(' ').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Адрес не найден');
    return { lat, lng, label: m.GeoObject.metaDataProperty.GeocoderMetaData.text };
  }

  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1` +
    `&accept-language=ru&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Геокодер вернул ошибку ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) throw new Error('Адрес не найден');
  const lat = parseFloat(j[0].lat);
  const lng = parseFloat(j[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Адрес не найден');
  return { lat, lng, label: j[0].display_name };
}

// from/to — { lat, lng }. Возвращает нормализованный маршрут (см. normalizeOSRM).
export async function route(from, to, opts = {}) {
  const profile =
    opts.profile === 'foot' ? 'walking' : opts.profile === 'bike' ? 'cycling' : 'driving';
  const base = opts.osrmUrl || 'https://router.project-osrm.org';
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `${base}/route/v1/${profile}/${coords}` +
    `?overview=full&geometries=geojson&steps=true&annotations=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Маршрутизатор вернул ошибку ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error('Не удалось построить маршрут');
  return normalizeOSRM(j.routes[0]);
}

// Приводим ответ OSRM к нашему виду:
//   coords:  [[lat,lng], ...] — полная геометрия,
//   cum:     накопленные длины по coords,
//   steps:   [{ along, location:[lat,lng], instruction, type, modifier, name }],
//            along — расстояние от старта до точки манёвра вдоль маршрута,
//   distance, duration — суммарные по маршруту.
function normalizeOSRM(rt) {
  const coords = rt.geometry.coordinates.map((c) => [c[1], c[0]]); // [lng,lat] → [lat,lng]
  const cum = cumulative(coords);
  const steps = [];

  // Привязываем каждый манёвр к вершине геометрии, двигаясь только вперёд:
  // так на маршрутах, проходящих рядом сами с собой (петли, развороты,
  // параллельные проезды), манёвр не «приклеится» к другому проходу маршрута.
  let from = 0;
  for (const leg of rt.legs) {
    for (const s of leg.steps) {
      const loc = s.maneuver.location; // [lng, lat]
      const location = [loc[1], loc[0]];
      let idx = from;
      let bd = Infinity;
      for (let i = from; i < coords.length; i++) {
        const d = haversine(coords[i], location);
        if (d < bd) {
          bd = d;
          idx = i;
        }
        if (bd < 1) break; // точное совпадение вершины (overview=full)
      }
      from = idx;
      steps.push({
        along: cum[idx],
        location,
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        exit: s.maneuver.exit,
        name: s.name || '',
        instruction: instructionText(s),
      });
    }
  }

  return { coords, cum, steps, distance: rt.distance, duration: rt.duration };
}

// Человекочитаемое расстояние: «250 метров», «1.2 км».
export function humanDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' км';
  return Math.round(m) + ' м';
}

// Округление дистанции до манёвра до «круглого» значения для озвучки.
export function announceDistance(m) {
  if (m >= 1000) return Math.round(m / 100) * 100;
  if (m >= 100) return Math.round(m / 50) * 50;
  return Math.round(m / 10) * 10;
}

// Расстояние словами для синтеза речи: «двести метров», «один километр».
// Принимает округлённое announceDistance() (метры кратны 10, км кратны 100),
// поэтому единица всегда согласуется как «метров»; для км — правильное склонение.
export function spokenDistance(m) {
  const plural = (n, one, few, many) => {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n100 >= 11 && n100 <= 14) return many;
    if (n10 === 1) return one;
    if (n10 >= 2 && n10 <= 4) return few;
    return many;
  };
  if (m >= 1000) {
    const km = m / 1000;
    if (Number.isInteger(km)) return km + ' ' + plural(km, 'километр', 'километра', 'километров');
    return km.toFixed(1).replace('.', ',') + ' километра';
  }
  return Math.round(m) + ' ' + plural(Math.round(m), 'метр', 'метра', 'метров');
}

export { haversine };
