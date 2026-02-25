import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const requiredEnvVars = [
  'WB_API_TOKEN',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Ошибка: переменная окружения ${envVar} не задана!`);
  }
}

export default {
  wb: {
    token: process.env.WB_API_TOKEN,
    baseURL: 'https://statistics-api.wildberries.ru',
    ordersEndpoint: '/api/v1/supplier/orders',
    timeout: parseInt(process.env.REQUEST_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,

    /* 
      по доке WB: лимит API статистики 1 запрос в минуту, превышение выдаст оштбку 429, выдерживаем паузу для пагинации.
    */
    paginationDelayMs: 61000,

    /* 
      0 берем всё, что изменилось с указанной даты, так мы подтянем и новые заказы, и любые изменения в старых
    */
    flag: 0,
  },

  cards: {
    endpoint: '/content/v2/get/cards/list',
    limit: 100,
    timeout: parseInt(process.env.CARDS_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.CARDS_MAX_RETRIES) || 3,
    paginationDelayMs: parseInt(process.env.CARDS_PAGINATION_DELAY) || 1000,
    batchDelayMs: parseInt(process.env.CARDS_BATCH_DELAY) || 500,
  },

  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    pool: {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },

  settings: {
    batchSize: parseInt(process.env.BATCH_SIZE) || 1000,
    daysToLoad: 30,
    excludeToday: true,

    /* 
      по доке WB: лимит записей в одном ответе 80 000
    */
    apiLimit: 80000,

    /* 
      дедупликация: используем srid (идентификатор записи в системе WB).
    */
    uniqueOrderField: 'srid',
  },

  moysklad: {
    token: process.env.MS_TOKEN,
    baseURL: process.env.MS_BASE_URL || 'https://api.moysklad.ru/api/remap/1.2',
    timeout: parseInt(process.env.MS_REQUEST_TIMEOUT) || 60000,
    maxRetries: parseInt(process.env.MS_MAX_RETRIES) || 5,
    retryDelayMs: parseInt(process.env.MS_RETRY_DELAY) || 5000,
    paginationDelayMs: parseInt(process.env.MS_PAGINATION_DELAY) || 2000,
    heavyRequestDelayMs: parseInt(process.env.MS_HEAVY_REQUEST_DELAY) || 20000,
  },

  ozon: {
    clientId: process.env.OZON_CLIENT_ID,
    apiKey: process.env.OZON_API_KEY,
    baseURL: 'https://api-seller.ozon.ru',
    fboEndpoint: '/v2/posting/fbo/list',
    fbsEndpoint: '/v3/posting/fbs/list',
    limit: 1000,
    timeout: parseInt(process.env.OZON_TIMEOUT) || 30000,
    paginationDelayMs: parseInt(process.env.OZON_PAGINATION_DELAY) || 200,
  },

  isProduction: process.env.NODE_ENV === 'production',
};
