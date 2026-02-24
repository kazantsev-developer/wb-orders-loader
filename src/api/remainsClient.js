import axios from 'axios';
import config from '../../config.js';

const REPORTS_API_URL = 'https://seller-analytics-api.wildberries.ru';

const reportsApi = axios.create({
  baseURL: REPORTS_API_URL,
  timeout: config.wb.timeout,
  headers: {
    Authorization: config.wb.token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createRemainsReport() {
  let retries = 0;

  while (retries < config.wb.maxRetries) {
    try {
      console.log('создание задачи на формирование отчета об остатках...');

      const response = await reportsApi.get('/api/v1/warehouse_remains');

      const taskId = response.data?.data?.taskId;

      if (!taskId) {
        throw new Error('не удалось получить task_id из ответа');
      }

      console.log(`задача создана, task_id: ${taskId}`);
      return taskId;
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        console.log('превышен лимит запросов, ожидание перед повтором...');
        await delay(60000);
        retries++;
        continue;
      }

      if (status >= 500) {
        retries++;
        const retryDelay = 1000 * Math.pow(2, retries - 1);
        console.log(
          `ошибка сервера WB (${status}), попытка ${retries}/${config.wb.maxRetries} через ${retryDelay}мс...`,
        );
        await delay(retryDelay);
        continue;
      }

      throw new Error(`ошибка создания отчета: ${error.message}`);
    }
  }

  throw new Error(
    `не удалось создать задачу после ${config.wb.maxRetries} попыток`,
  );
}

export async function checkReportStatus(taskId) {
  let retries = 0;

  while (retries < config.wb.maxRetries) {
    try {
      const response = await reportsApi.get(
        `/api/v1/warehouse_remains/tasks/${taskId}/status`,
      );

      const status = response.data?.status || response.data?.data?.status;

      if (!status) {
        throw new Error('не удалось получить статус из ответа');
      }

      return status;
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        console.log(
          'превышен лимит запросов при проверке статуса, ожидание...',
        );
        await delay(60000);
        retries++;
        continue;
      }

      if (status === 404) {
        throw new Error(
          `задача ${taskId} не найдена (возможно истек срок хранения)`,
        );
      }

      if (status >= 500) {
        retries++;
        const retryDelay = 1000 * Math.pow(2, retries - 1);
        console.log(
          `ошибка сервера WB (${status}) при проверке статуса, попытка ${retries}/${config.wb.maxRetries}...`,
        );
        await delay(retryDelay);
        continue;
      }

      throw new Error(`ошибка проверки статуса: ${error.message}`);
    }
  }

  throw new Error(
    `не удалось проверить статус после ${config.wb.maxRetries} попыток`,
  );
}

export async function waitForReportReady(taskId, pollInterval = 5000) {
  console.log(`ожидание готовности отчета, task_id: ${taskId}`);

  while (true) {
    const status = await checkReportStatus(taskId);
    console.log(`статус отчета: ${status}`);

    switch (status) {
      case 'done':
        console.log('отчет готов к скачиванию');
        return;

      case 'error':
        throw new Error('ошибка при формировании отчета на стороне WB');

      case 'pending':
      case 'processing':
        console.log(
          `отчет формируется, следующая проверка через ${pollInterval / 1000} сек...`,
        );
        await delay(pollInterval);
        break;

      default:
        throw new Error(`неизвестный статус отчета: ${status}`);
    }
  }
}

export async function downloadRemainsReport(taskId) {
  let retries = 0;

  while (retries < config.wb.maxRetries) {
    try {
      console.log(`скачивание отчета, task_id: ${taskId}`);

      const response = await reportsApi.get(
        `/api/v1/warehouse_remains/tasks/${taskId}/download`,
      );

      const data = response.data;

      if (!Array.isArray(data)) {
        console.log('ответ не является массивом, проверяем структуру:', data);
        if (data?.data && Array.isArray(data.data)) {
          return data.data;
        }
        throw new Error('неожиданный формат ответа от API');
      }

      console.log(`скачано записей: ${data.length}`);
      return data;
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        console.log('превышен лимит запросов при скачивании, ожидание...');
        await delay(60000);
        retries++;
        continue;
      }

      if (status === 404) {
        throw new Error(
          `отчет ${taskId} не найден (возможно истек срок хранения)`,
        );
      }

      if (status >= 500) {
        retries++;
        const retryDelay = 1000 * Math.pow(2, retries - 1);
        console.log(
          `ошибка сервера WB (${status}) при скачивании, попытка ${retries}/${config.wb.maxRetries}...`,
        );
        await delay(retryDelay);
        continue;
      }

      throw new Error(`ошибка скачивания отчета: ${error.message}`);
    }
  }

  throw new Error(
    `не удалось скачать отчет после ${config.wb.maxRetries} попыток`,
  );
}

export async function fetchRemains() {
  try {
    const taskId = await createRemainsReport();

    await waitForReportReady(taskId);

    const remains = await downloadRemainsReport(taskId);

    return remains;
  } catch (error) {
    console.error('ошибка при получении остатков:', error.message);
    throw error;
  }
}
