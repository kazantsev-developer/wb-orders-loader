import config from './config.js';
import pool, { testConnection } from './src/db/connection.js';
import {
  upsertCardsBatch,
  saveCursorState,
  getLastCursor,
  insertCardsLog,
  getCardsStats,
} from './src/db/cardsQueries.js';
import {
  fetchAllCards,
  normalizeCard,
  testConnection as testApiConnection,
} from './src/api/cardsClient.js';

const SCRIPT_VERSION = '1.0 (карточки товаров)';

async function syncCards() {
  if (!config.wb.token) {
    throw new Error('WB_API_TOKEN не задан в .env');
  }

  const startTime = Date.now();
  let syncStatus = 'success';
  let errorMessage = null;
  let totalProcessed = 0;
  let batchesCount = 0;
  let lastCursor = null;
  let lastCursorState = null;

  console.log(`[${new Date().toISOString()}] запуск синхронизации карточек`);
  console.log(`версия: ${SCRIPT_VERSION}`);

  try {
    console.log('\n--- шаг 1: проверка подключений ---');

    const dbOk = await testConnection();
    if (!dbOk) throw new Error('не удалось подключиться к БД');

    const apiOk = await testApiConnection();
    if (!apiOk) throw new Error('не удалось подключиться к api WB');

    console.log('\n--- шаг 2: получение состояния пагинации ---');
    lastCursorState = await getLastCursor();

    if (lastCursorState) {
      console.log(
        `найден курсор: updatedAt=${lastCursorState.updatedAt}, nmID=${lastCursorState.nmID}`,
      );
      console.log('инкрементальная выгрузка (только изменения)');
    } else {
      console.log('курсор не найден, полная выгрузка всех карточек');
    }

    console.log('\n--- шаг 3: статистика до выгрузки ---');
    const statsBefore = await getCardsStats();
    console.log(`карточек в БД: ${statsBefore?.total_cards || 0}`);

    console.log('\n--- шаг 4: выгрузка карточек из api ---');

    const result = await fetchAllCards(async (cards, cursor) => {
      batchesCount++;

      console.log(`\n[пачка ${batchesCount}] получено: ${cards.length}`);

      const normalizedCards = cards.map(normalizeCard);
      const saveResult = await upsertCardsBatch(normalizedCards);
      totalProcessed += saveResult.count;

      console.log(
        `[пачка ${batchesCount}] сохранено: ${saveResult.count}, ошибок: ${saveResult.errors.length}`,
      );

      if (cursor) {
        await saveCursorState(cursor.updatedAt, cursor.nmID);
        lastCursor = cursor;
        console.log(
          `[пачка ${batchesCount}] курсор обновлен: ${cursor.updatedAt}, nmID=${cursor.nmID}`,
        );
      }

      if (config.cards?.batchDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.cards.batchDelayMs),
        );
      }
    }, lastCursorState);

    console.log('\n--- шаг 5: выгрузка завершена ---');
    console.log(`пачек: ${result.batchesCount}`);
    console.log(`карточек получено: ${result.totalCards}`);
    console.log(`сохранено в БД: ${totalProcessed}`);

    console.log('\n--- шаг 6: статистика после выгрузки ---');
    const statsAfter = await getCardsStats();
    console.log(`карточек в БД: ${statsAfter?.total_cards || 0}`);
    console.log(`обновлено за час: ${statsAfter?.updated_last_hour || 0}`);
  } catch (error) {
    console.error('\n!!! критическая ошибка:', error.message);
    syncStatus = 'error';
    errorMessage = error.message;
  } finally {
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log('\n--- итоги ---');
    console.log(`статус: ${syncStatus}`);
    console.log(`обработано: ${totalProcessed}`);
    console.log(`пачек: ${batchesCount}`);
    console.log(`время: ${executionTime} сек`);

    if (lastCursor) {
      console.log(
        `последний курсор: updatedAt=${lastCursor.updatedAt}, nmID=${lastCursor.nmID}`,
      );
    }

    try {
      const logId = await insertCardsLog({
        status: syncStatus,
        recordsCount: totalProcessed,
        dateFrom: lastCursorState?.updatedAt || null,
        dateTo: lastCursor?.updatedAt || null,
        errorMessage: errorMessage,
        pagesCount: batchesCount,
        executionTimeSeconds: executionTime,
      });
      console.log(`лог сохранен, id: ${logId}`);
    } catch (logError) {
      console.error('ошибка сохранения лога:', logError.message);
    }

    console.log(`\n[${new Date().toISOString()}] завершение`);
  }
}

async function checkLastSync() {
  try {
    const stats = await getCardsStats();
    if (stats?.last_sync) {
      console.log('\n--- последняя синхронизация ---');
      console.log(`время: ${stats.last_sync.sync_at}`);
      console.log(`статус: ${stats.last_sync.status}`);
      console.log(`карточек: ${stats.last_sync.records_count}`);
      console.log(`страниц: ${stats.last_sync.pages_count}`);
    } else {
      console.log('синхронизация еще не выполнялась');
    }
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
    getCardsStats()
      .then((stats) => {
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
      })
      .catch((error) => {
        console.error('ошибка:', error.message);
        process.exit(1);
      });
  } else {
    syncCards()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('критическая ошибка:', error.message);
        process.exit(1);
      });
  }
}

export { syncCards, checkLastSync };
