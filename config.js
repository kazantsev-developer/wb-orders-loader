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

  isProduction: process.env.NODE_ENV === 'production',
};
