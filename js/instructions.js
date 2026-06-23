// instructions.js — превращаем манёвр OSRM в русскую фразу.
// OSRM отдаёт maneuver.type + maneuver.modifier + название улицы (step.name).

const DIR = {
  left: 'налево',
  right: 'направо',
  'slight left': 'плавно налево',
  'slight right': 'плавно направо',
  'sharp left': 'резко налево',
  'sharp right': 'резко направо',
  straight: 'прямо',
  uturn: 'в обратную сторону',
};

const ORD = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой'];

function onStreet(name) {
  return name ? ` на ${name}` : '';
}
function byStreet(name) {
  return name ? ` по ${name}` : '';
}

// step — объект шага OSRM (с полями maneuver, name).
export function instructionText(step) {
  const m = step.maneuver || {};
  const type = m.type;
  const mod = m.modifier;
  const name = step.name || '';

  switch (type) {
    case 'depart':
      return `Начинаем маршрут${byStreet(name)}`;

    case 'turn':
      if (mod === 'uturn') return 'Развернитесь';
      if (mod === 'straight') return `Продолжайте движение прямо${byStreet(name)}`;
      // Без известного направления не командуем «поверните» вслепую.
      return DIR[mod]
        ? `Поверните ${DIR[mod]}` + onStreet(name)
        : `Продолжайте движение${byStreet(name)}`;

    case 'new name':
    case 'continue':
      if (mod === 'uturn') return 'Развернитесь';
      return `Продолжайте движение${byStreet(name)}`;

    case 'merge': {
      // Для перестроения осмысленны только лево/право; «прямо»/«разворот» — нет.
      const side = mod && mod !== 'straight' && mod !== 'uturn' ? DIR[mod] || '' : '';
      return ('Перестройтесь' + (side ? ' ' + side : '')).trim() + onStreet(name);
    }

    case 'on ramp':
      // Въезд на дорогу: используем направление съезда, если оно есть.
      return `Выезжайте${mod && DIR[mod] ? ' ' + DIR[mod] : ''}`.trim() + onStreet(name);

    case 'off ramp':
      return `Съезжайте${mod && DIR[mod] ? ' ' + DIR[mod] : ''}`.trim() + onStreet(name);

    case 'fork':
      return `На развилке держитесь ${DIR[mod] || 'прямо'}`;

    case 'end of road':
      return DIR[mod]
        ? `В конце дороги поверните ${DIR[mod]}` + onStreet(name)
        : `Продолжайте движение${byStreet(name)}`;

    case 'roundabout':
    case 'rotary':
    case 'roundabout turn': {
      const exit = m.exit ? ORD[m.exit] || `${m.exit}-й` : '';
      if (exit) return `На круговом движении сверните на ${exit} съезд${onStreet(name)}`;
      return `Двигайтесь по круговому движению${onStreet(name)}`;
    }

    case 'exit roundabout':
    case 'exit rotary':
      return `Съезд с кругового движения${onStreet(name)}`;

    case 'arrive':
      if (mod === 'left') return 'Пункт назначения слева. Вы прибыли';
      if (mod === 'right') return 'Пункт назначения справа. Вы прибыли';
      return 'Вы прибыли в пункт назначения';

    default:
      if (mod && DIR[mod]) return `Двигайтесь ${DIR[mod]}` + onStreet(name);
      return `Продолжайте движение${byStreet(name)}`;
  }
}
