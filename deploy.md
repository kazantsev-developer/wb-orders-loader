# Инструкция по деплою (Ubuntu 24.04)

1. **Установка окружения:**
   `apt update && apt install -y nodejs npm postgresql`

2. **Настройка проекта:**
   `npm install axios luxon pg dotenv`
   `nano .env` (Добавить WB_API_TOKEN и DATABASE_URL)

3. **База данных:**
   Выполнить команды из `init.sql` в вашей БД PostgreSQL.

4. **Настройка Cron (каждые 30 минут):**
   `crontab -e`
   Добавить:
   `*/30 * * * * cd /путь/к/проекту && /usr/bin/node src/index.js >> sync.log 2>&1`
   `*/30 * * * * cd /root/wb-orders-loader && node index-remains.js >> /var/log/wb-remains.log 2>&1`

5. **Проверка:**
   `node src/index.js`
   `node index-remains.js`

## МойСклад (остатки по складам)

- **Файлы:** `index-moysklad.js`, `src/api/moyskladClient.js`, `src/db/moyskladQueries.js`
- **Добавить в .env:** `MS_TOKEN`, `MS_BASE_URL=https://api.moysklad.ru/api/remap/1.2`
- **Cron:** `*/30 * * * * cd /root/wb-orders-loader && node index-moysklad.js >> /root/wb-orders-loader/logs/moysklad-cron.log 2>&1`
- **Проверка:** `node index-moysklad.js`

## Карточки товаров Wildberries

- **Файлы:** `index-cards.js`, `src/api/cardsClient.js`, `src/db/cardsQueries.js`
- **Таблицы в БД:** уже включены в `init.sql` (`wb_cards`, `sync_cursor_state`)
- **Настройка .env:** используются существующие `WB_API_TOKEN` и параметры БД (дополнительные переменные не требуются)
- **Cron:** `*/30 * * * * cd /root/wb-orders-loader && node index-cards.js >> /var/log/wb-cards.log 2>&1`
- **Проверка:**
  - `node index-cards.js` (полная выгрузка при первом запуске)
  - `node index-cards.js check` (проверка последней синхронизации)
  - `node index-cards.js stats` (статистика по карточкам)
