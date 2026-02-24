import axios from 'axios';
import config from '../../config.js';

const API_BASE_URL = config.moysklad.baseURL;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: config.moysklad.timeout,
  headers: {
    Authorization: `Bearer ${config.moysklad.token}`,
    'Accept-Encoding': 'gzip, deflate, br',
    Accept: 'application/json;charset=utf-8',
    'Content-Type': 'application/json',
  },

  paramsSerializer: (params) => {
    const searchParams = new URLSearchParams();
    for (const key in params) {
      if (Array.isArray(params[key])) {
        searchParams.append(key, params[key].join(','));
      } else {
        searchParams.append(key, params[key]);
      }
    }
    return searchParams.toString();
  },
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let requestTimestamps = [];

function checkRateLimit(isHeavy = false) {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((ts) => now - ts < 60000);

  // тяжелые 5 в минуту, обычные 45
  const limit = isHeavy ? 5 : 45;

  if (requestTimestamps.length >= limit) {
    const oldest = requestTimestamps[0];
    const waitTime = 60000 - (now - oldest);
    if (waitTime > 0) {
      console.log(
        `достигнут лимит ${isHeavy ? 'тяжелых' : 'обычных'} запросов, ожидание ${Math.ceil(waitTime / 1000)}с...`,
      );
      return waitTime;
    }
  }

  requestTimestamps.push(now);
  return 0;
}

async function rateLimitedRequest(requestFn, isHeavy = false) {
  let retries = 0;
  const maxRetries = config.moysklad.maxRetries;

  while (retries < maxRetries) {
    const waitTime = checkRateLimit(isHeavy);
    if (waitTime > 0) {
      await delay(waitTime);
      continue;
    }

    try {
      return await requestFn();
    } catch (error) {
      if (error.response?.status === 429) {
        retries++;
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after']) * 1000
          : config.moysklad.retryDelayMs * Math.pow(2, retries - 1);

        console.log(
          `превышен лимит (429), попытка ${retries}/${maxRetries}, ожидание ${retryAfter / 1000}с...`,
        );
        await delay(retryAfter);
        continue;
      }

      if (error.response?.status >= 500) {
        retries++;
        const retryDelay =
          config.moysklad.retryDelayMs * Math.pow(2, retries - 1);
        console.log(
          `ошибка сервера (${error.response.status}), попытка ${retries}/${maxRetries} через ${retryDelay / 1000}с...`,
        );
        await delay(retryDelay);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`превышено количество попыток (${maxRetries})`);
}

export async function fetchStores() {
  let offset = 0;
  const limit = 1000;
  let allStores = [];

  console.log('получение списка складов...');

  while (true) {
    try {
      const response = await rateLimitedRequest(async () => {
        return await apiClient.get('/entity/store', {
          params: {
            limit,
            offset,
            fields: 'id,name,code,externalCode,address,created,updated',
          },
        });
      }, false);

      const stores = response.data.rows || [];
      allStores = [...allStores, ...stores];

      console.log(`получено складов: ${stores.length}, offset: ${offset}`);

      if (stores.length < limit) {
        break;
      }

      offset += limit;

      if (config.moysklad.paginationDelayMs > 0) {
        await delay(config.moysklad.paginationDelayMs);
      }
    } catch (error) {
      console.error('ошибка при получении складов:', error.message);
      throw error;
    }
  }

  console.log(`всего получено складов: ${allStores.length}`);
  return allStores;
}

export async function fetchStockByStore(limit = 1000, offset = 0) {
  return await rateLimitedRequest(async () => {
    const response = await apiClient.get('report/stock/byStore', {
      params: {
        limit,
        offset,
        stockMode: 'byStore',
      },
    });

    return {
      rows: response.data.rows || [],
      meta: response.data.meta || {},
    };
  }, true);
}

export async function fetchAllStockByStore() {
  const limit = 1000;
  let offset = 0;
  let allRows = [];
  let totalCount = 0;
  let pageNum = 1;

  console.log('получение остатков по складам (тяжелые запросы, 5 в минуту)...');

  while (true) {
    try {
      console.log(`запрос страницы ${pageNum}, offset: ${offset}`);

      const { rows, meta } = await fetchStockByStore(limit, offset);

      if (!totalCount && meta?.size) {
        totalCount = meta.size;
        console.log(`всего записей по метаданным: ${totalCount}`);
      }

      allRows = [...allRows, ...rows];
      console.log(`получено строк: ${rows.length}, всего: ${allRows.length}`);

      const hasStockByStore = rows.some(
        (row) =>
          row.stockByStore &&
          Array.isArray(row.stockByStore) &&
          row.stockByStore.length > 0,
      );

      if (!hasStockByStore) {
        console.warn(
          'внимание: в ответе отсутствует детализация stockByStore!',
        );
      }

      if (rows.length < limit) {
        console.log('достигнут конец данных');
        break;
      }

      offset += limit;
      pageNum++;

      const heavyDelay = config.moysklad.heavyRequestDelayMs || 20000;
      console.log(
        `ожидание ${heavyDelay / 1000}с перед следующим тяжелым запросом...`,
      );
      await delay(heavyDelay);
    } catch (error) {
      console.error('ошибка при пагинации:', error.message);
      throw error;
    }
  }

  console.log(`всего получено строк отчета: ${allRows.length}`);
  return allRows;
}

export function extractUuidFromHref(href) {
  if (!href) return null;
  const parts = href.split('/');
  return parts[parts.length - 1] || null;
}

export function extractStoreName(storeMeta) {
  if (!storeMeta) return 'неизвестно';
  if (storeMeta.name) return storeMeta.name;
  return extractUuidFromHref(storeMeta.href) || 'неизвестно';
}

export function normalizeStockData(rows, snapshotId) {
  const stockDetails = [];
  const productTotals = new Map();

  for (const row of rows) {
    const productUuid = extractUuidFromHref(row.product?.meta?.href);
    if (!productUuid) {
      console.warn('пропуск строки: не удалось извлечь uuid товара', row);
      continue;
    }

    const article = row.product?.article || null;
    const productName = row.product?.name || null;

    if (!productTotals.has(productUuid)) {
      productTotals.set(productUuid, {
        product_uuid: productUuid,
        article: article,
        name: productName,
        total_stock: 0,
        total_reserve: 0,
        total_in_transit: 0,
      });
    }

    const totals = productTotals.get(productUuid);

    if (article && !totals.article) totals.article = article;
    if (productName && !totals.name) totals.name = productName;

    if (Array.isArray(row.stockByStore)) {
      for (const stockItem of row.stockByStore) {
        const storeUuid = extractUuidFromHref(stockItem.store?.meta?.href);
        if (!storeUuid) continue;

        const quantity = stockItem.quantity || 0;
        const reserve = stockItem.reserve || 0;
        const inTransit = stockItem.inTransit || 0;

        stockDetails.push({
          snapshot_id: snapshotId,
          product_uuid: productUuid,
          store_uuid: storeUuid,
          stock: quantity,
          reserve: reserve,
          in_transit: inTransit,
        });

        totals.total_stock += quantity;
        totals.total_reserve += reserve;
        totals.total_in_transit += inTransit;
      }
    }
  }

  const productAggregates = Array.from(productTotals.values());

  return {
    stockDetails,
    productAggregates,
  };
}
