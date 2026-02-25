import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import {
  upsertOzonOrdersBatch,
  insertOzonLog,
  getOzonStats,
} from './src/db/ozonOrdersQueries.js';
import {
  fetchAllFBOOrders,
  fetchAllFBSOrders,
  normalizeOrder,
  testConnection as testApiConnection,
} from './src/api/ozonOrdersClient.js';

const SCRIPT_VERSION = '1.0 (заказы Озон)';

function formatDateForOzon(date) {
  return date.toISOString().split('.')[0] + 'Z';
}

function calculateDateRange() {
  const now = new Date();

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const dateTo = new Date(today);

  const dateFrom = new Date(today);
  dateFrom.setDate(dateFrom.getDate() - 30);

  return {
    dateFrom: formatDateForOzon(dateFrom),
    dateTo: formatDateForOzon(dateTo),
    humanReadable: {
      from: dateFrom.toLocaleDateString('ru-RU'),
      to: dateTo.toLocaleDateString('ru-RU'),
    },
  };
}

async function syncOzonOrders() {
  if (!config.ozon?.clientId || !config.ozon?.apiKey) {
    throw new Error('OZON_CLIENT_ID или OZON_API_KEY не заданы в .env');
  }

  const startTime = Date.now();
  const range = calculateDateRange();

  let totalProcessed = 0;
  const results = [];

  console.log(
    `[${new Date().toISOString()}] запуск синхронизации заказов Озон`,
  );
  console.log(`версия: ${SCRIPT_VERSION}`);
  console.log(
    `период: ${range.humanReadable.from} — ${range.humanReadable.to}`,
  );
  console.log(`формат api: since=${range.dateFrom}, to=${range.dateTo}`);

  try {
    console.log('\n--- шаг 1: проверка подключений ---');

    const dbOk = await testConnection();
    if (!dbOk) throw new Error('не удалось подключиться к БД');

    const apiOk = await testApiConnection();
    if (!apiOk) throw new Error('не удалось подключиться к API Ozon');

    console.log('\n--- шаг 2: статистика до выгрузки ---');
    const statsBefore = await getOzonStats();
    console.log(`заказов в БД: ${statsBefore?.total_orders || 0}`);
    if (statsBefore?.by_scheme) {
      console.log('по схеме:', statsBefore.by_scheme);
    }

    console.log('\n--- шаг 3: выгрузка FBO заказов ---');

    const fboResult = await fetchAllFBOOrders(
      range.dateFrom,
      range.dateTo,
      async (orders, scheme) => {
        console.log(`\n[FBO] получено: ${orders.length} заказов`);

        const normalizedOrders = orders.map((o) => normalizeOrder(o, 'FBO'));
        const saveResult = await upsertOzonOrdersBatch(normalizedOrders, 'FBO');

        console.log(
          `[FBO] сохранено: ${saveResult.count}, ошибок: ${saveResult.errors.length}`,
        );

        totalProcessed += saveResult.count;
      },
    );

    results.push({
      scheme: 'FBO',
      ...fboResult,
    });

    console.log('\n--- шаг 4: выгрузка FBS заказов ---');

    const fbsResult = await fetchAllFBSOrders(
      range.dateFrom,
      range.dateTo,
      async (orders, scheme) => {
        console.log(`\n[FBS] получено: ${orders.length} заказов`);

        const normalizedOrders = orders.map((o) => normalizeOrder(o, 'FBS'));
        const saveResult = await upsertOzonOrdersBatch(normalizedOrders, 'FBS');

        console.log(
          `[FBS] сохранено: ${saveResult.count}, ошибок: ${saveResult.errors.length}`,
        );

        totalProcessed += saveResult.count;
      },
    );

    results.push({
      scheme: 'FBS',
      ...fbsResult,
    });

    console.log('\n--- шаг 5: статистика после выгрузки ---');
    const statsAfter = await getOzonStats();
    console.log(`заказов в БД: ${statsAfter?.total_orders || 0}`);
    if (statsAfter?.by_scheme) {
      console.log('по схеме:', statsAfter.by_scheme);
    }
    console.log(`обновлено за час: ${statsAfter?.updated_last_hour || 0}`);

    console.log('\n--- шаг 6: сохранение логов ---');

    for (const result of results) {
      if (result.totalOrders > 0) {
        const logId = await insertOzonLog({
          status: 'success',
          scheme: result.scheme,
          recordsCount: result.totalOrders,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          executionTimeMs: Date.now() - startTime,
        });
        console.log(`лог для ${result.scheme} сохранен, id: ${logId}`);
      }
    }
  } catch (error) {
    console.error('\n!!! критическая ошибка:', error.message);

    try {
      await insertOzonLog({
        status: 'error',
        scheme: 'ALL',
        errorMessage: error.message,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        executionTimeMs: Date.now() - startTime,
      });
      console.log('лог ошибки сохранен');
    } catch (logError) {
      console.error('ошибка сохранения лога:', logError.message);
    }
  } finally {
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log('\n--- итоги выполнения ---');
    console.log(`статус: ${errorMessage ? 'error' : 'success'}`);
    console.log(`всего обработано заказов: ${totalProcessed}`);
    console.log(`время выполнения: ${executionTime} сек`);

    for (const result of results) {
      console.log(
        `${result.scheme}: пачек ${result.batchesCount}, заказов ${result.totalOrders}`,
      );
    }

    console.log(
      `\n[${new Date().toISOString()}] ===== ЗАВЕРШЕНИЕ РАБОТЫ =====`,
    );
  }
}

async function checkLastSync() {
  try {
    const stats = await getOzonStats();
    if (stats?.last_sync) {
      console.log('\n--- последняя синхронизация Ozon ---');
      console.log(`время: ${stats.last_sync.sync_at}`);
      console.log(`статус: ${stats.last_sync.status}`);
      console.log(`схема: ${stats.last_sync.scheme}`);
      console.log(`заказов: ${stats.last_sync.records_count}`);
      console.log(
        `период: ${stats.last_sync.date_from} — ${stats.last_sync.date_to}`,
      );
      console.log(`время выполнения: ${stats.last_sync.execution_time_ms} мс`);
    } else {
      console.log('синхронизация Ozon еще не выполнялась');
    }
  } catch (error) {
    console.error('ошибка:', error.message);
  }
}

async function showStats() {
  try {
    const stats = await getOzonStats();
    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error('ошибка:', error.message);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes('check')) {
    checkLastSync()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('критическая ошибка:', error.message);
        process.exit(1);
      });
  } else if (args.includes('stats')) {
    showStats()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('ошибка:', error.message);
        process.exit(1);
      });
  } else {
    syncOzonOrders()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('критическая ошибка:', error.message);
        process.exit(1);
      });
  }
}

export { syncOzonOrders, checkLastSync, showStats };
