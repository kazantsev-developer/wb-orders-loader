import { DateTime } from 'luxon';

export function calculateDateRange() {
  const nowMoscow = DateTime.now().setZone('Europe/Moscow');

  // вчерашний день
  const dateTo = nowMoscow.minus({ days: 1 }).endOf('day').toUTC().toISO();
  // 30 дней назад от сегодня
  const dateFrom = nowMoscow.minus({ days: 30 }).startOf('day').toUTC().toISO();

  return {
    dateFrom,
    dateTo,
    humanReadable: {
      from: nowMoscow.minus({ days: 30 }).toFormat('dd.MM.yyyy'),
      to: nowMoscow.minus({ days: 1 }).toFormat('dd.MM.yyyy'),
    },

    // пояснение!
    note: 'api принимает только dateFrom, фильтрация будет на стороне БД',
  };
}

export function getNextDateFrom(lastChangeDate) {
  return DateTime.fromISO(lastChangeDate)
    .plus({ milliseconds: 1 })
    .toUTC()
    .toISO();
}

export function shouldContinuePagination(orders, apiLimit) {
  return orders.length >= apiLimit;
}

// за последние 30 дней минус сегодня
export function filterOrdersByDate(orders, dateFrom, dateTo) {
  const from = DateTime.fromISO(dateFrom);
  const to = DateTime.fromISO(dateTo);

  return orders.filter((order) => {
    const orderDate = DateTime.fromISO(order.date);

    return orderDate >= from && orderDate <= to;
  });
}

export function analyzeDateDistribution(orders) {
  if (!orders || orders.length === 0) return null;

  const dates = orders.map((o) => ({
    date: o.date,
    lastChangeDate: o.lastChangeDate,
  }));

  return {
    sample: dates.slice(0, 3),
    note: 'date - создание заказа, lastChangeDate - крайнее изменение',
  };
}
