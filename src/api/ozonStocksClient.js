import axios from 'axios';
import config from '../../config.js';

const OZON_API_URL = 'https://api-seller.ozon.ru';

const ozonApi = axios.create({
  baseURL: OZON_API_URL,
  timeout: config.ozon?.timeout || 30000,
  headers: {
    'Client-Id': config.ozon?.clientId,
    'Api-Key': config.ozon?.apiKey,
    'Content-Type': 'application/json',
  },
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchStocksBatch(lastId = '', limit = 100) {
  let retries = 0;
  const maxRetries = config.ozon?.maxRetries || 3;

  while (retries < maxRetries) {
    try {
      const listResponse = await ozonApi.post('/v3/product/list', {
        filter: { visibility: 'ALL' },
        limit: Math.min(limit, 100),
        last_id: lastId || '',
      });

      const listResult = listResponse.data?.result;
      if (!listResult || !listResult.items || listResult.items.length === 0) {
        return { stocks: [], lastId: '', hasNext: false };
      }

      const offerIds = listResult.items.map((item) => item.offer_id);

      const stocksResponse = await ozonApi.post('/v3/product/info/stocks', {
        offer_id: offerIds,
      });

      const stocksResult = stocksResponse.data?.result;
      const stocks = stocksResult?.items || [];
      const newLastId = listResult.last_id || '';

      console.log(`[OzonStocksAPI] получено остатков: ${stocks.length}`);

      return {
        stocks,
        lastId: newLastId,
        hasNext: !!newLastId,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error(`[OzonStocksAPI] ошибка:`, {
        status,
        message: error.message,
        data: errorData,
      });

      if (status === 429) {
        retries++;
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after']) * 1000
          : Math.min(1000 * Math.pow(2, retries), 30000);

        console.log(
          `[OzonStocksAPI] превышен лимит (429), ожидание ${retryAfter / 1000}с, попытка ${retries}/${maxRetries}`,
        );

        if (retries < maxRetries) {
          await delay(retryAfter);
          continue;
        }
      }

      if (status >= 500 && status < 600) {
        retries++;
        const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 30000);

        console.log(
          `[OzonStocksAPI] ошибка сервера (${status}), ожидание ${retryDelay / 1000}с, попытка ${retries}/${maxRetries}`,
        );

        if (retries < maxRetries) {
          await delay(retryDelay);
          continue;
        }
      }

      throw new Error(
        `ошибка API остатков Ozon: ${error.message}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`,
      );
    }
  }

  throw new Error(`не удалось получить остатки после ${maxRetries} попыток`);
}

export async function fetchAllStocks(onBatch) {
  let lastId = '';
  let totalProcessed = 0;
  let batchesCount = 0;
  let hasMore = true;
  const limit = 100;

  console.log(`[OzonStocksAPI] начало выгрузки остатков`);

  while (hasMore) {
    try {
      const {
        stocks,
        lastId: newLastId,
        hasNext,
      } = await fetchStocksBatch(lastId, limit);

      batchesCount++;
      totalProcessed += stocks.length;

      if (stocks.length > 0) {
        await onBatch(stocks);
      }

      if (!hasNext) {
        hasMore = false;
        console.log(`[OzonStocksAPI] достигнут конец данных`);
      } else {
        lastId = newLastId;

        if (config.ozon?.paginationDelayMs) {
          await delay(config.ozon.paginationDelayMs);
        }
      }
    } catch (error) {
      console.error(`[OzonStocksAPI] ошибка при пагинации:`, error.message);
      throw error;
    }
  }

  console.log(
    `[OzonStocksAPI] выгрузка завершена: пачек ${batchesCount}, записей ${totalProcessed}`,
  );

  return {
    totalStocks: totalProcessed,
    batchesCount,
  };
}

export function normalizeStock(stock) {
  const fboStock = stock.stocks?.find((s) => s.warehouse_type === 'FBO') || {};

  return {
    sku: stock.product_id,
    product_id: stock.product_id,
    item_code: stock.offer_id,
    category: stock.category,
    brand: stock.brand,
    name: stock.name,
    fbo_visible_amount: fboStock.present || 0,
    fbo_present_amount: fboStock.present || 0,
  };
}

export async function testConnection() {
  try {
    const { stocks } = await fetchStocksBatch('', 1);
    return true;
  } catch (error) {
    console.error('[OzonStocksAPI] ошибка подключения:', error.message);
    return false;
  }
}
