import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import {
  fetchStores,
  fetchAllStockByStore,
  normalizeStockData,
} from './src/api/moyskladClient.js';
import {
  upsertStores,
  createSnapshot,
  insertStockDetailsBatch,
  upsertProductAggregates,
  insertJobLog,
} from './src/db/moyskladQueries.js';

const SCRIPT_VERSION = '1.0 (мой склад)';

async function syncMoysklad() {
  if (!config.moysklad?.token) {
    throw new Error('MS_TOKEN не задан в .env');
  }

  const startTime = Date.now();
  let syncStatus = 'success';
  let errorMessage = null;

  let storesCount = 0;
  let stockRowsCount = 0;
  let detailsCount = 0;
  let aggregatesCount = 0;

  console.log(`[${new Date().toISOString()}] запуск синхронизации МойСклад`);
  console.log(`версия: ${SCRIPT_VERSION}`);

  try {
    console.log('проверка подключения к БД...');
    const dbOk = await testConnection();
    if (!dbOk) {
      throw new Error('не удалось подключиться к БД');
    }

    console.log('\n--- шаг 1: получение складов ---');
    const stores = await fetchStores();
    if (stores.length > 0) {
      const result = await upsertStores(stores);
      storesCount = result.count;
      console.log(`сохранено складов: ${storesCount}`);
    } else {
      console.log('склады не получены, продолжаем...');
    }

    console.log('\n--- шаг 2: создание снимка ---');
    const snapshotId = await createSnapshot();
    console.log(`создан снимок id: ${snapshotId}`);

    console.log('\n--- шаг 3: получение остатков ---');
    const stockRows = await fetchAllStockByStore();
    stockRowsCount = stockRows.length;
    console.log(`получено строк отчета: ${stockRowsCount}`);

    if (stockRowsCount === 0) {
      console.log('нет данных для обработки');
    } else {
      console.log('\n--- шаг 4: нормализация данных ---');
      const { stockDetails, productAggregates } = normalizeStockData(
        stockRows,
        snapshotId,
      );

      detailsCount = stockDetails.length;
      aggregatesCount = productAggregates.length;

      console.log(`детальных записей по складам: ${detailsCount}`);
      console.log(`агрегированных записей по товарам: ${aggregatesCount}`);

      if (stockDetails.length > 0) {
        console.log('\n--- шаг 5: сохранение детальных остатков ---');
        const detailsResult = await insertStockDetailsBatch(stockDetails);
        console.log(`сохранено детальных записей: ${detailsResult.count}`);
      }

      if (productAggregates.length > 0) {
        console.log('\n--- шаг 6: сохранение агрегатов по товарам ---');
        const aggregatesResult = await upsertProductAggregates(
          productAggregates.map((a) => ({ ...a, snapshot_id: snapshotId })),
        );
        console.log(`сохранено агрегатов: ${aggregatesResult.count}`);
      }
    }

    console.log('\n--- синхронизация завершена успешно ---');
  } catch (error) {
    console.error('\n!!! ошибка:', error.message);
    if (error.response) {
      console.error('статус:', error.response.status);
      console.error('данные:', error.response.data);
    }
    syncStatus = 'error';
    errorMessage = error.message;
  } finally {
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log('\n--- итоги выполнения ---');
    console.log(`складов: ${storesCount}`);
    console.log(`строк отчета: ${stockRowsCount}`);
    console.log(`детальных записей: ${detailsCount}`);
    console.log(`агрегатов: ${aggregatesCount}`);
    console.log(`время выполнения: ${executionTime} сек`);
    console.log(`статус: ${syncStatus}`);

    try {
      const logId = await insertJobLog({
        status: syncStatus,
        recordsCount: stockRowsCount,
        detailsCount: detailsCount,
        aggregatesCount: aggregatesCount,
        errorMessage: errorMessage,
        executionTimeSeconds: executionTime,
      });
      console.log(`лог сохранен, id: ${logId}`);
    } catch (logError) {
      console.error(`ошибка сохранения лога: ${logError.message}`);
    }

    console.log(`[${new Date().toISOString()}] завершение работы`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncMoysklad()
    .then(() => {
      console.log('скрипт выполнен успешно');
      process.exit(0);
    })
    .catch((error) => {
      console.error('критическая ошибка:', error.message);
      process.exit(1);
    });
}

export default syncMoysklad;
