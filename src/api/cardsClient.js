/*

Клиент для Content API Wildberries (базовый URL: https://content-api.wildberries.ru)

Методы:
fetchCardsBatch(cursor, limit) - получение пачки карточек с cursor-пагинацией

Обработка 429 и retry логика (как в других клиентах)

*/