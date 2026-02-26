import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import { upsertOrdersBatch, insertSyncLog } from './src/db/queries.js';
import { fetchOrders, delay } from './src/api/wbClient.js';
import {
  calculateDateRange,
  getNextDateFrom,
  shouldContinuePagination,
  filterOrdersByDate,
} from './src/utils/dateUtils.js';

// запуск каждые 30 минут (по cron)
async function syncOrders() {
  if (!config.wb.token) {
    throw new Error('WB_API_TOKEN не задан в .env');
  }
  const startTime = Date.now();
  const range = calculateDateRange();

  console.log(`[${new Date().toISOString()}] запуск синхронизации заказов`);
  console.log(
    `период: ${range.humanReadable.from} — ${range.humanReadable.to}`,
  );

  let currentDateFrom = range.dateFrom;
  let totalProcessed = 0;
  let pageCount = 0;
  let syncStatus = 'success';
  let errorMessage = null;

  try {
    console.log('проверка подключения к БД...');
    const dbOk = await testConnection();
    if (!dbOk) {
      throw new Error('не удалось подключиться к БД');
    }

    while (true) {
      console.log(
        `запрос страницы ${pageCount + 1}, dateFrom: ${currentDateFrom}`,
      );

      const orders = await fetchOrders(currentDateFrom);
      pageCount++;

      if (!orders || orders.length === 0) {
        console.log('данные закончились');
        break;
      }

      console.log(`получено записей: ${orders.length}`);

      const filteredOrders = filterOrdersByDate(
        orders,
        range.dateFrom,
        range.dateTo,
      );
      console.log(`после фильтрации: ${filteredOrders.length}`);

      if (filteredOrders.length > 0) {
        const result = await upsertOrdersBatch(filteredOrders);
        totalProcessed += result.count;
        console.log(`сохранено в БД: ${result.count}`);
      }

      if (!shouldContinuePagination(orders, config.settings.apiLimit)) {
        console.log('последняя страница');
        break;
      }

      const lastOrder = orders[orders.length - 1];
      currentDateFrom = getNextDateFrom(lastOrder.lastChangeDate);

      console.log(
        `ожидание ${config.wb.paginationDelayMs / 1000} сек (rate limit)...`,
      );
      await delay(config.wb.paginationDelayMs);
    }
  } catch (error) {
    console.error('ошибка:', error.message);
    syncStatus = 'error';
    errorMessage = error.message;
  } finally {
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log(`всего страниц: ${pageCount}`);
    console.log(`всего заказов: ${totalProcessed}`);
    console.log(`время выполнения: ${executionTime} сек`);
    console.log(`статус: ${syncStatus}`);

    try {
      const logId = await insertSyncLog({
        status: syncStatus,
        recordsCount: totalProcessed,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        errorMessage: errorMessage,
        pagesCount: pageCount,
        executionTimeSeconds: executionTime,
      });
      console.log(`лог сохранен, id: ${logId}`);
    } catch (logError) {
      console.error('ошибка сохранения лога:', logError.message);
    }

    console.log(`[${new Date().toISOString()}] завершение работы`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncOrders()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('критическая ошибка:', error.message);
      process.exit(1);
    });
}

export default syncOrders;
