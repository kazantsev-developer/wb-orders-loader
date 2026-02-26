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

export async function fetchStocksBatch(offset = 0, limit = 1000) {
  let retries = 0;
  const maxRetries = config.ozon?.maxRetries || 3;

  const requestBody = {
    limit: Math.min(limit, 1000),
    offset: String(offset),
    filter: {},
  };

  console.log(`[OzonStocksAPI] запрос: offset=${offset}, limit=${limit}`);

  while (retries < maxRetries) {
    try {
      const response = await ozonApi.post('/v1/analytics/stocks', requestBody);
      const result = response.data?.result;

      if (!result) {
        throw new Error('пустой ответ от api');
      }

      const stocks = result.rows || [];
      const total = result.counter || 0;

      console.log(
        `[OzonStocksAPI] получено: ${stocks.length}, всего: ${total}`,
      );

      return {
        stocks,
        total,
        nextOffset: offset + stocks.length,
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
        `ошибка api остатков Ozon: ${error.message}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`,
      );
    }
  }

  throw new Error(`не удалось получить остатки после ${maxRetries} попыток`);
}

export async function fetchAllStocks(onBatch) {
  let offset = 0;
  let totalProcessed = 0;
  let batchesCount = 0;
  let hasMore = true;
  const limit = config.ozon?.limit || 1000;

  console.log(`[OzonStocksAPI] начало выгрузки остатков`);

  while (hasMore) {
    try {
      const { stocks, total, nextOffset } = await fetchStocksBatch(
        offset,
        limit,
      );

      batchesCount++;
      totalProcessed += stocks.length;

      if (stocks.length > 0) {
        await onBatch(stocks);
      }

      if (stocks.length < limit || nextOffset >= total) {
        hasMore = false;
        console.log(`[OzonStocksAPI] достигнут конец данных`);
      } else {
        offset = nextOffset;

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
  return {
    sku: stock.sku,
    product_id: stock.product_id,
    item_code: stock.item_code || stock.offer_id || null,
    category: stock.category,
    brand: stock.brand,
    name: stock.name,
    fbo_visible_amount: stock.fbo_visible_amount || 0,
    fbo_present_amount: stock.fbo_present_amount || 0,
  };
}

export async function testConnection() {
  try {
    const { stocks } = await fetchStocksBatch(0, 1);
    return true;
  } catch (error) {
    console.error('[OzonStocksAPI] ошибка подключения:', error.message);
    return false;
  }
}
