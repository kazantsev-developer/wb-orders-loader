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
        retries++;
        console.log(
          `превышен лимит, попытка: ${retries}/${config.wb.maxRetries}, ждем...`,
        );
        await delay(80000);
        continue;
      }

      if (status >= 500) {
        retries++;
        const retryDelay = 1000 * Math.pow(2, retries - 1);
        console.log(
          `ошибка сервера WB (${status}), попытка ${retries} через ${retryDelay / 1000}с...`,
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
        await delay(70000);
        return checkReportStatus(taskId);
      }

      if (status === 404) {
        throw new Error(
          `задача ${taskId} не найдена (возможно истек срок хранения)`,
        );
      }

      if (status >= 500) {
        console.log(
          `ошибка сервера WB (${status}) при проверке статуса, попытка ${retries}/${config.wb.maxRetries}...`,
        );
        await delay(30000);
        return checkReportStatus(taskId);
      }

      throw new Error(`ошибка проверки статуса: ${error.message}`);
    }
  }

  throw new Error(
    `не удалось проверить статус после ${config.wb.maxRetries} попыток`,
  );
}

export async function waitForReportReady(taskId, pollInterval = 30000) {
  console.log(`ожидание готовности отчета, task_id: ${taskId}`);

  while (true) {
    const status = await checkReportStatus(taskId);
    console.log(`статус отчета: ${status}`);

    switch (status) {
      case 'done':
        console.log('отчет готов. Ждем 180 секунд перед скачиванием...');
        await delay(180000);
        console.log('переходим к скачиванию...');
        return;

      case 'error':
        throw new Error('ошибка при формировании отчета на стороне WB');

      case 'new':
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
  try {
    console.log(`скачивание отчета, task_id: ${taskId}`);
    const response = await reportsApi.get(
      `/api/v1/warehouse_remains/tasks/${taskId}/download`,
    );
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 429) {
      console.error('лимит. ждем 5 минут для финальной попытки...');
      await delay(300000);
      const finalResponse = await reportsApi.get(
        `/api/v1/warehouse_remains/tasks/${taskId}/download`,
      );
      return finalResponse.data.data;
    }
    throw error;
  }
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
