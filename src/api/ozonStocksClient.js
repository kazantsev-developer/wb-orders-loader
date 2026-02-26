import axios from 'axios';
import config from '../../config.js';

const OZON_API_URL = 'https://api-seller.ozon.ru';

const ozonApi = axios.create({
  baseURL: OZON_API_URL,
  timeout: config.ozon?.timeout || 30000,
  headers: {
    'Client-Id': config.ozon?.clientId,
    'Api-Key': config.ozon?.apiKey,
    'Content-Type': 'application/json'
  }
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchStocksBatch(lastId = '', limit = 100) {
  try {
    const res = await ozonApi.post('/v3/product/list', {
      filter: { visibility: 'ALL' },
      limit: Math.min(limit, 100),
      last_id: lastId || ''
    });

    const items = res.data.result?.items || [];
    console.log(`[OzonStocksAPI] получено товаров: ${items.length}`);

    return {
      stocks: items,
      lastId: res.data.result?.last_id || '',
      hasNext: !!res.data.result?.last_id
    };
  } catch (error) {
    console.error('[OzonStocksAPI] ошибка:', error.message);
    throw error;
  }
}

export async function fetchAllStocks(onBatch) {
  let lastId = "";
  let totalProcessed = 0;
  let batchesCount = 0;
  let hasMore = true;
  const limit = 100;

  console.log(`[OzonStocksAPI] начало выгрузки`);

  while (hasMore) {
    try {
      const { stocks, lastId: newLastId, hasNext } = await fetchStocksBatch(lastId, limit);

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

  console.log(`[OzonStocksAPI] выгрузка завершена: пачек ${batchesCount}, записей ${totalProcessed}`);
  return { totalStocks: totalProcessed, batchesCount };
}

export function normalizeStock(item) {
  return {
    sku: item.product_id,
    product_id: item.product_id,
    item_code: item.offer_id,
    category: '',
    brand: '',
    name: item.offer_id || 'Ozon Product',
    fbo_visible_amount: item.has_fbo_stocks ? 1 : 0,
    fbo_present_amount: item.has_fbo_stocks ? 1 : 0,
  };
}

export async function testConnection() {
  try {
    await fetchStocksBatch('', 1);
    return true;
  } catch (error) {
    console.error('[OzonStocksAPI] ошибка подключения:', error.message);
    return false;
  }
}
