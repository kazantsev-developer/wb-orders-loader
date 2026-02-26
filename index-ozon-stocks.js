import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import {
  upsertStocksBatch,
  resetStaleStocks,
  insertStocksLog,
  getStocksStats,
} from './src/db/ozonStocksQueries.js';
import {
  fetchAllStocks,
  normalizeStock,
  testConnection as testApiConnection,
} from './src/api/ozonStocksClient.js';

const SCRIPT_VERSION = '1.0 (остатки Озон)';

async function syncOzonStocks() {
  if (!config.ozon?.clientId || !config.ozon?.apiKey) {
    throw new Error('OZON_CLIENT_ID или OZON_API_KEY не заданы в .env');
  }

  const startTime = Date.now();
  const syncStartTime = new Date();

  let totalProcessed = 0;
  let batchesCount = 0;
  let syncStatus = 'success';
  let errorMessage = null;

  console.log(
    `[${new Date().toISOString()}] --- запуск синхронизации остатков ---`,
  );
  console.log(`версия: ${SCRIPT_VERSION}`);

  try {
    console.log('\n--- шаг 1: проверка подключений ---');

    const dbOk = await testConnection();
    if (!dbOk) throw new Error('не удалось подключиться к БД');

    const apiOk = await testApiConnection();
    if (!apiOk) throw new Error('не удалось подключиться к api Озон');

    console.log('\n--- шаг 2: статистика до выгрузки ---');
    const statsBefore = await getStocksStats();
    console.log(`товаров в БД: ${statsBefore?.total_products || 0}`);
    console.log(`всего доступно: ${statsBefore?.total_visible || 0}`);
    console.log(`всего с резервом: ${statsBefore?.total_present || 0}`);

    // Шаг 3: Выгрузка остатков из API
    console.log('\n--- шаг 3: выгрузка остатков из api ---');

    const result = await fetchAllStocks(async (stocks) => {
      batchesCount++;

      console.log(
        `\n[пачка ${batchesCount}] получено: ${stocks.length} записей`,
      );

      const normalizedStocks = stocks.map(normalizeStock);
      const saveResult = await upsertStocksBatch(normalizedStocks);
      totalProcessed += saveResult.count;

      console.log(
        `[пачка ${batchesCount}] сохранено: ${saveResult.count}, ошибок: ${saveResult.errors.length}`,
      );
    });

    // Шаг 4: Обнуление устаревших остатков
    console.log('\n--- шаг 4: обнуление устаревших остатков ---');
    const resetCount = await resetStaleStocks(syncStartTime);
    console.log(`обнулено товаров, отсутствующих в выгрузке: ${resetCount}`);

    // Шаг 5: Статистика после выгрузки
    console.log('\n--- шаг 5: статистика после выгрузки ---');
    const statsAfter = await getStocksStats();
    console.log(`товаров в БД: ${statsAfter?.total_products || 0}`);
    console.log(`всего доступно: ${statsAfter?.total_visible || 0}`);
    console.log(`всего с резервом: ${statsAfter?.total_present || 0}`);
    console.log(`обновлено за час: ${statsAfter?.updated_last_hour || 0}`);

    if (statsAfter?.top_brands?.length > 0) {
      console.log('\nтоп-5 брендов по остаткам:');
      statsAfter.top_brands.slice(0, 5).forEach((brand, idx) => {
        console.log(
          `  ${idx + 1}. ${brand.brand || 'без бренда'}: ${brand.visible} шт. (${brand.products} товаров)`,
        );
      });
    }
  } catch (error) {
    console.error('\n!!! критическая ошибка:', error.message);
    syncStatus = 'error';
    errorMessage = error.message;
  } finally {
    const executionTime = Date.now() - startTime;

    console.log('\n--- итоги выполнения ---');
    console.log(`статус: ${syncStatus}`);
    console.log(`обработано записей: ${totalProcessed}`);
    console.log(`пачек: ${batchesCount}`);
    console.log(
      `время выполнения: ${executionTime} мс (${Math.round(executionTime / 1000)} сек)`,
    );

    try {
      const logId = await insertStocksLog({
        status: syncStatus,
        recordsCount: totalProcessed,
        dateFrom: null,
        dateTo: null,
        errorMessage: errorMessage,
        executionTimeMs: executionTime,
      });
      console.log(`лог сохранен, id: ${logId}`);
    } catch (logError) {
      console.error('ошибка сохранения лога:', logError.message);
    }

    console.log(
      `\n[${new Date().toISOString()}] --- завершение работы ---`,
    );
  }
}

async function checkLastSync() {
  try {
    const stats = await getStocksStats();
    if (stats?.last_sync) {
      console.log('\n--- последняя синхронизация остатков Озон ---');
      console.log(`время: ${stats.last_sync.sync_at}`);
      console.log(`статус: ${stats.last_sync.status}`);
      console.log(`записей: ${stats.last_sync.records_count}`);
      console.log(`время выполнения: ${stats.last_sync.execution_time_ms} мс`);
    } else {
      console.log('синхронизация остатков Озон еще не выполнялась');
    }
  } catch (error) {
    console.error('ошибка:', error.message);
  }
}

async function showStats() {
  try {
    const stats = await getStocksStats();
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
    syncOzonStocks()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('критическая ошибка:', error.message);
        process.exit(1);
      });
  }
}

export { syncOzonStocks, checkLastSync, showStats };
