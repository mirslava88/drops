// nav.js — движок навигации: следим за позицией, считаем расстояние до
// ближайшего манёвра, вовремя озвучиваем его, ловим сход с маршрута.

import { snapToRoute, haversine } from './geo.js';
import { announceDistance, humanDistance, spokenDistance } from './routing.js';

// Пороги по профилю: PREP — заранее, NEAR — ближе, NOW — на самом манёвре,
// ARRIVE — радиус «прибытия», SPEED — скорость по умолчанию для расчёта ETA (м/с).
const PROFILE = {
  driving: { PREP: 400, NEAR: 150, NOW: 40, ARRIVE: 25, OFFROUTE: 50, SPEED: 11 },
  bike: { PREP: 200, NEAR: 80, NOW: 25, ARRIVE: 15, OFFROUTE: 40, SPEED: 4.5 },
  foot: { PREP: 120, NEAR: 50, NOW: 15, ARRIVE: 12, OFFROUTE: 35, SPEED: 1.4 },
};

export class NavEngine {
  constructor(route, profile = 'driving') {
    this.route = route;
    this.cfg = PROFILE[profile] || PROFILE.driving;
    // Указатель на ближайший предстоящий манёвр (пропускаем стартовый 'depart').
    this.ptr = route.steps.findIndex((s) => s.type !== 'depart');
    if (this.ptr < 0) this.ptr = route.steps.length - 1;
    this.announced = { prep: false, near: false, now: false };
    this.offCount = 0;
    this.arrived = false;
    this.lastAlong = null; // прогресс на прошлом фиксе (для оконной привязки)
    // Колбэки задаёт вызывающий код:
    this.onInstruction = null; // (text, {distance, immediate})
    this.onProgress = null; // ({remaining, eta, distToManeuver, instruction, offRoute})
    this.onReroute = null; // (position) — попросить пересчитать маршрут
    this.onArrive = null; // ()
  }

  // Заменить маршрут после пересчёта, сохранив состояние «в пути».
  setRoute(route) {
    this.route = route;
    this.ptr = route.steps.findIndex((s) => s.type !== 'depart');
    if (this.ptr < 0) this.ptr = route.steps.length - 1;
    this.announced = { prep: false, near: false, now: false };
    this.offCount = 0;
    this.arrived = false;
    this.lastAlong = null; // после пересчёта первый фикс привязываем глобально
  }

  _resetAnnounce() {
    this.announced = { prep: false, near: false, now: false };
  }

  // pos — { lat, lng, accuracy, speed }. Вызывается на каждое обновление GPS.
  update(pos) {
    if (this.arrived) return;
    const p = [pos.lat, pos.lng];
    const { coords, cum, steps } = this.route;

    // Привязку ищем в окне вокруг прошлого прогресса, иначе на маршрутах,
    // проходящих рядом сами с собой, позиция может «прилипнуть» к чужому участку.
    const snap = snapToRoute(coords, cum, p, this.lastAlong);
    const acc = pos.accuracy || 0;

    // Сход с маршрута: учитываем погрешность GPS, чтобы не дёргаться зря.
    const offBy = snap.dist - Math.min(acc, 30);
    if (offBy > this.cfg.OFFROUTE) {
      this.offCount++;
      if (this.offCount >= 3 && this.onReroute) {
        this.offCount = 0;
        this.onReroute(pos);
        return;
      }
    } else {
      this.offCount = 0;
    }

    const along = snap.along;
    this.lastAlong = along;
    // remaining и along в одной шкале (длина полилинии cum), а не rt.distance,
    // иначе «прибытие» может не сработать или сработать раньше времени.
    const routeLen = cum[cum.length - 1];
    const remaining = Math.max(0, routeLen - along);

    // Сдвигаем указатель вперёд, если манёвр уже пройден (с запасом 8 м).
    while (this.ptr < steps.length - 1 && along > steps[this.ptr].along + 8) {
      const passed = steps[this.ptr];
      // Если манёвр проскочили между редкими фиксами GPS и так и не озвучили
      // в момент прохождения — произносим команду сейчас, чтобы не пропустить.
      if (passed.type !== 'depart' && !this.announced.now && this.onInstruction) {
        this.onInstruction(passed.instruction, { immediate: true });
      }
      this.ptr++;
      this._resetAnnounce();
    }

    const step = steps[this.ptr];
    const isLast = this.ptr >= steps.length - 1; // обычно это 'arrive'
    const distToManeuver = Math.max(0, step.along - along);

    // Прибытие.
    if (isLast && remaining <= this.cfg.ARRIVE) {
      this.arrived = true;
      if (this.onInstruction) this.onInstruction(step.instruction, { immediate: true });
      if (this.onArrive) this.onArrive();
      return;
    }

    // Озвучка манёвра по порогам. Для последнего шага — только финальная фраза.
    if (!isLast) {
      const d = distToManeuver;
      if (d <= this.cfg.NOW && !this.announced.now) {
        this.announced.now = true;
        this.announced.near = true;
        this.announced.prep = true;
        if (this.onInstruction) this.onInstruction(step.instruction, { immediate: true });
      } else if (d <= this.cfg.NEAR && !this.announced.near) {
        this.announced.near = true;
        this.announced.prep = true;
        this._say(step, d);
      } else if (d <= this.cfg.PREP && !this.announced.prep) {
        this.announced.prep = true;
        this._say(step, d);
      }
    }

    // Прогресс на экран.
    if (this.onProgress) {
      const speed = pos.speed && pos.speed > 1 ? pos.speed : this.cfg.SPEED;
      this.onProgress({
        remaining,
        remainingText: humanDistance(remaining),
        eta: Math.round(remaining / speed), // секунды
        distToManeuver,
        distToManeuverText: humanDistance(distToManeuver),
        instruction: step.instruction,
        offRoute: this.offCount > 0,
      });
    }
  }

  _say(step, d) {
    if (!this.onInstruction) return;
    const rounded = announceDistance(d);
    // spokenDistance даёт «через двести метров», а не «через 200 м» (TTS читает «эм»).
    this.onInstruction(`Через ${spokenDistance(rounded)} ${low(step.instruction)}`, {
      distance: rounded,
    });
  }
}

// «Поверните направо» → «поверните направо» (чтобы звучало внутри фразы).
function low(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
