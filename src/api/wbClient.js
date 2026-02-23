import axios from 'axios';
import config from '../../config.js';

const apiClient = axios.create({
  baseURL: config.wb.baseURL,
  timeout: config.wb.timeout,
  headers: {
    Authorization: config.wb.token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchOrders(dateFrom) {
  let retries = 0;

  while (retries < config.wb.maxRetries) {
    try {
      const response = await apiClient.get(config.wb.ordersEndpoint, {
        params: {
          dateFrom: dateFrom,
          flag: config.wb.flag,
        },
      });

      return response.data;
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        console.log(`rate limit превышен, ожидание 65 сек...`);
        await delay(65000);
        retries++;
        continue;
      }

      if (status >= 500) {
        retries++;
        const retryDelay = 1000 * Math.pow(2, retries - 1);
        await delay(retryDelay);
        continue;
      }

      throw new Error(`ошибка api: ${error.message}`);
    }
  }

  throw new Error(
    `не удалось получить данные после ${config.wb.maxRetries} попыток`,
  );
}
