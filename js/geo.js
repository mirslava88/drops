// geo.js — геометрия на сфере и привязка точки к маршруту.
// Все координаты — пары [lat, lng] в градусах. Все расстояния — в метрах.

export const EARTH_R = 6371000; // средний радиус Земли, м

export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;

// Расстояние по дуге большого круга (формула гаверсинусов), метры.
export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Начальный азимут из a в b, градусы [0, 360).
export function bearing(a, b) {
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Локальная плоская проекция точки p в метры (x — на восток, y — на север)
// относительно начала origin. Для дистанций до ~10 км ошибка пренебрежима.
export function project(p, origin) {
  const x = toRad(p[1] - origin[1]) * Math.cos(toRad(origin[0])) * EARTH_R;
  const y = toRad(p[0] - origin[0]) * EARTH_R;
  return [x, y];
}

// Накопленная длина полилинии: cum[i] — расстояние от начала до точки i, м.
export function cumulative(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  return cum;
}

// Индекс ближайшей к p вершины полилинии (для привязки манёвров к геометрии).
export function nearestIndex(coords, p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(coords[i], p);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

// Ближайшая точка отрезка AB к точке P (в плоских координатах) и параметр t∈[0,1].
function nearestOnSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { point: [a[0] + t * abx, a[1] + t * aby], t };
}

// Привязка позиции p к маршруту coords (cum — его накопленные длины).
// Возвращает: dist — отклонение от маршрута (м), seg — индекс сегмента,
// along — пройденное расстояние вдоль маршрута до точки привязки (м).
// prevAlong — прогресс на прошлом фиксе: при заданном значении предпочитаем
// привязку в окне [prevAlong-back, prevAlong+fwd], чтобы на самопересекающихся
// маршрутах не «перепрыгнуть» на другой проход. Глобальный минимум берём как
// запасной вариант, только если он заметно ближе (реальный сход с маршрута).
export function snapToRoute(coords, cum, p, prevAlong = null, back = 100, fwd = 1500) {
  let best = { dist: Infinity, seg: 0, t: 0, along: 0 };
  let win = { dist: Infinity, seg: 0, t: 0, along: 0 };
  const lo = prevAlong == null ? -Infinity : prevAlong - back;
  const hi = prevAlong == null ? Infinity : prevAlong + fwd;
  for (let i = 0; i < coords.length - 1; i++) {
    // Проецируем относительно самой p, поэтому p == начало координат [0,0].
    const a = project(coords[i], p);
    const b = project(coords[i + 1], p);
    const ns = nearestOnSegment([0, 0], a, b);
    const d = Math.hypot(ns.point[0], ns.point[1]);
    const segLen = cum[i + 1] - cum[i];
    const along = cum[i] + segLen * ns.t;
    if (d < best.dist) best = { dist: d, seg: i, t: ns.t, along };
    if (along >= lo && along <= hi && d < win.dist) {
      win = { dist: d, seg: i, t: ns.t, along };
    }
  }
  if (prevAlong != null && win.dist < Infinity && win.dist <= best.dist + 25) return win;
  return best;
}
