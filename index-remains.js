import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import { insertSyncLog } from './src/db/queries.js';
import { fetchRemains } from './src/api/remainsClient.js';
import {
  normalizeRemainsData,
  upsertRemainsBatch,
} from './src/db/remainsQueries.js';

const SCRIPT_VERSION = '1.0 (остатки)';

async function syncRemains() {
  if (!config.wb.token) {
    throw new Error('WB_API_TOKEN не задан в .env');
  }
  const startTime = Date.now();
  let totalProcessed = 0;
  let syncStatus = 'success';
  let errorMessage = null;

  console.log(`[${new Date().toISOString()}] запуск синхронизации остатков`);
  console.log(`версия: ${SCRIPT_VERSION}`);

  try {
    console.log('проверка подключения к БД...');
    const dbOk = await testConnection();
    if (!dbOk) {
      throw new Error('не удалось подключиться к БД');
    }

    console.log('запрос остатков...');
    const remainsData = await fetchRemains();
    console.log(`получено записей от API: ${remainsData.length}`);

    const normalizedData = normalizeRemainsData(remainsData);
    console.log(`после нормализации: ${normalizedData.length}`);

    if (normalizedData.length > 0) {
      const result = await upsertRemainsBatch(normalizedData);
      totalProcessed = result.count;
      console.log(`сохранено в БД: ${totalProcessed}`);
    } else {
      console.log('нет данных для сохранения');
    }
  } catch (error) {
    console.error('ошибка:', error.message);
    syncStatus = 'error';
    errorMessage = error.message;
  } finally {
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log(`всего записей: ${totalProcessed}`);
    console.log(`время выполнения: ${executionTime} сек`);
    console.log(`статус: ${syncStatus}`);

    try {
      const logId = await insertSyncLog({
        status: syncStatus,
        recordsCount: totalProcessed,
        dateFrom: null,
        dateTo: null,
        errorMessage: errorMessage,
        pagesCount: 1,
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
  syncRemains()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('критическая ошибка:', error.message);
      process.exit(1);
    });
}

export default syncRemains;
