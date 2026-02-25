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

export async function fetchFBOOrdersBatch(since, to, offset = 0, limit = 1000) {
  let retries = 0;
  const maxRetries = 3;

  const requestBody = {
    dir: 'ASC',
    filter: {
      since,
      to,
    },
    limit: Math.min(limit, 1000),
    offset,
    with: {
      analytics_data: true,
      financial_data: true,
    },
  };

  console.log(`[OzonAPI] FBO: offset=${offset}, since=${since}, to=${to}`);

  while (retries < maxRetries) {
    try {
      const response = await ozonApi.post('/v2/posting/fbo/list', requestBody);
      const result = response.data?.result;

      if (!result) {
        throw new Error('пустой ответ от api');
      }

      const orders = result.postings || [];
      const total = result.total || orders.length;

      console.log(`[OzonAPI] FBO: получено ${orders.length}, всего: ${total}`);

      return {
        orders,
        total,
        nextOffset: offset + orders.length,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error(`[OzonAPI] ошибка FBO:`, {
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
          `[OzonAPI] превышен лимит (429), ожидание ${retryAfter / 1000}с, попытка ${retries}/${maxRetries}`,
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
          `[OzonAPI] ошибка сервера (${status}), ожидание ${retryDelay / 1000}с, попытка ${retries}/${maxRetries}`,
        );

        if (retries < maxRetries) {
          await delay(retryDelay);
          continue;
        }
      }

      throw new Error(
        `ошибка api Озон FBO: ${error.message}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`,
      );
    }
  }

  throw new Error(`не удалось получить заказы FBO после ${maxRetries} попыток`);
}

export async function fetchFBSOrdersBatch(
  since,
  to,
  lastId = null,
  limit = 1000,
) {
  let retries = 0;
  const maxRetries = 3;

  const requestBody = {
    dir: 'ASC',
    filter: {
      since,
      to,
    },
    limit: Math.min(limit, 1000),
    last_id: lastId,
    with: {
      analytics_data: true,
      financial_data: true,
    },
  };

  console.log(
    `[OzonAPI] FBS: last_id=${lastId || 'null'}, since=${since}, to=${to}`,
  );

  while (retries < maxRetries) {
    try {
      const response = await ozonApi.post('/v3/posting/fbs/list', requestBody);
      const result = response.data?.result;

      if (!result) {
        throw new Error('пустой ответ от apiKey');
      }

      const orders = result.postings || [];
      const hasNext = result.has_next && orders.length > 0;

      if (orders.length > 0) {
        console.log(`[DEBUG FBS] Первый заказ: ${orders[0].posting_number}`);
        console.log(`[DEBUG FBS] Последний заказ: ${orders[orders.length-1].posting_number}`);
        console.log(`[DEBUG FBS] Всего заказов: ${orders.length}, hasNext: ${hasNext}`);
      } else {
        console.log(`[DEBUG FBS] Заказов нет, hasNext: ${hasNext}`);
      }

      return {
        orders,
        hasNext,
        lastId: orders.length > 0 ? orders[orders.length - 1].posting_number : lastId,
      };
    } catch (error) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      console.error(`[OzonAPI] ошибка FBS:`, {
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
          `[OzonAPI] превышен лимит (429), ожидание ${retryAfter / 1000}с, попытка ${retries}/${maxRetries}`,
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
          `[OzonAPI] ошибка сервера (${status}), ожидание ${retryDelay / 1000}с, попытка ${retries}/${maxRetries}`,
        );

        if (retries < maxRetries) {
          await delay(retryDelay);
          continue;
        }
      }

      throw new Error(
        `ошибка api Ozon FBS: ${error.message}${errorData ? ' - ' + JSON.stringify(errorData) : ''}`,
      );
    }
  }

  throw new Error(`не удалось получить заказы FBS после ${maxRetries} попыток`);
}

export async function fetchAllFBOOrders(since, to, onBatch) {
  let offset = 0;
  let totalProcessed = 0;
  let batchesCount = 0;
  let hasMore = true;
  const limit = config.ozon?.limit || 1000;

  console.log(`[OzonAPI] начало выгрузки FBO заказов`);

  while (hasMore) {
    try {
      const { orders, total, nextOffset } = await fetchFBOOrdersBatch(
        since,
        to,
        offset,
        limit,
      );

      batchesCount++;
      totalProcessed += orders.length;

      if (orders.length > 0) {
        await onBatch(orders, 'FBO');
      }

      if (orders.length < limit || nextOffset >= total) {
        hasMore = false;
        console.log(`[OzonAPI] достигнут конец данных для FBO`);
      } else {
        offset = nextOffset;

        if (config.ozon?.paginationDelayMs) {
          await delay(config.ozon.paginationDelayMs);
        }
      }
    } catch (error) {
      console.error(`[OzonAPI] ошибка при пагинации FBO:`, error.message);
      throw error;
    }
  }

  console.log(
    `[OzonAPI] выгрузка FBO завершена: пачек ${batchesCount}, заказов ${totalProcessed}`,
  );

  return {
    totalOrders: totalProcessed,
    batchesCount,
  };
}

export async function fetchAllFBSOrders(since, to, onBatch) {
  let lastId = null;
  let totalProcessed = 0;
  let batchesCount = 0;
  let hasMore = true;
  const limit = config.ozon?.limit || 1000;

  console.log(`[OzonAPI] начало выгрузки FBS заказов`);

  while (hasMore) {
    try {
      const {
        orders,
        hasNext,
        lastId: newLastId,
      } = await fetchFBSOrdersBatch(since, to, lastId, limit);

      console.log(`[DEBUG PAGINATION] lastId было: ${lastId}, newLastId стало: ${newLastId}, orders.length: ${orders.length}, hasNext: ${hasNext}`);

      batchesCount++;
      totalProcessed += orders.length;

      if (orders.length > 0) {
        await onBatch(orders, 'FBS');
      }

      if (!hasNext || orders.length < limit) {
        hasMore = false;
        console.log(`[OzonAPI] достигнут конец данных для FBS`);
      } else {
        if (newLastId === lastId) {
          console.warn(`[WARNING] lastId не изменился! Возможно бесконечный цикл. newLastId=${newLastId}, lastId=${lastId}`);
          hasMore = false;
        } else {
          lastId = newLastId;
          console.log(`[DEBUG] lastId обновлен: ${lastId}`);

          if (config.ozon?.paginationDelayMs) {
            await delay(config.ozon.paginationDelayMs);
          }
        }
      }
    } catch (error) {
      console.error(`[OzonAPI] ошибка при пагинации FBS:`, error.message);
      throw error;
    }
  }

  console.log(
    `[OzonAPI] выгрузка FBS завершена: пачек ${batchesCount}, заказов ${totalProcessed}`,
  );

  return {
    totalOrders: totalProcessed,
    batchesCount,
  };
}

export function normalizeOrder(order, scheme) {
  return {
    posting_number: order.posting_number,
    order_id: order.order_id,
    order_number: order.order_number,
    status: order.status,
    delivery_method_id: order.delivery_method?.id || null,
    tpl_integration_type: order.tpl_integration_type,
    created_at: order.created_at,
    in_process_at: order.in_process_at,
    shipment_date: order.shipment_date,
    delivering_date: order.delivering_date,
    products: order.products || [],
    analytics_data: order.analytics_data || {},
    financial_data: order.financial_data || {},
    scheme,
  };
}

export async function testConnection() {
  try {
    const now = new Date();
    const to = now.toISOString();
    const since = new Date(now.setDate(now.getDate() - 1)).toISOString();

    await fetchFBOOrdersBatch(since, to, 0, 1);
    return true;
  } catch (error) {
    console.error('[OzonAPI] ошибка подключения:', error.message);
    return false;
  }
}
