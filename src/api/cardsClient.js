import axios from 'axios';
import config from '../../config.js';

const CONTENT_API_URL = 'https://content-api.wildberries.ru';

const contentApi = axios.create({
  baseURL: CONTENT_API_URL,
  timeout: config.cards?.timeout || config.wb.timeout || 30000,
  headers: {
    Authorization: config.wb.token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchCardsBatch(cursor = null, limit = 100) {
  let retries = 0;
  const maxRetries = config.cards?.maxRetries || 3;

  const requestBody = {
    settings: {
      cursor: {
        ...(cursor || {}),
        limit: Math.min(limit, 100),
      },
      filter: {
        withPhoto: -1,
      },
    },
  };

  if (!cursor) {
    requestBody.settings.cursor = {
      limit: Math.min(limit, 100),
    };
  }

  while (retries < maxRetries) {
    try {
      const response = await contentApi.post(
        config.cards?.endpoint || '/content/v2/get/cards/list',
        requestBody,
      );

      const cards = response.data.cards || response.data.data?.cards || [];
      const nextCursor =
        response.data.cursor || response.data.data?.cursor || null;

      return { cards, cursor: nextCursor };
    } catch (error) {
      const status = error.response?.status;

      if (status === 429) {
        retries++;
        const retryAfter = error.response.headers['retry-after']
          ? parseInt(error.response.headers['retry-after']) * 1000
          : Math.min(1000 * Math.pow(2, retries), 30000);

        if (retries < maxRetries) {
          await delay(retryAfter);
          continue;
        }
      }

      if (status >= 500 && status < 600) {
        retries++;
        const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 30000);

        if (retries < maxRetries) {
          await delay(retryDelay);
          continue;
        }
      }

      throw new Error(`ошибка api карточек: ${error.message}`);
    }
  }

  throw new Error(`не удалось получить карточки после ${maxRetries} попыток`);
}

export async function fetchAllCards(onBatch, startCursor = null) {
  let currentCursor = startCursor;
  let totalCards = 0;
  let batchesCount = 0;
  let hasMore = true;

  while (hasMore) {
    const { cards, cursor } = await fetchCardsBatch(
      currentCursor,
      config.cards?.limit || 100,
    );

    batchesCount++;
    totalCards += cards.length;

    if (cards.length > 0) {
      await onBatch(cards, cursor);
    }

    if (cards.length < (config.cards?.limit || 100) || !cursor) {
      hasMore = false;
    } else {
      currentCursor = cursor;

      if (config.cards?.paginationDelayMs) {
        await delay(config.cards.paginationDelayMs);
      }
    }
  }

  return { totalCards, batchesCount, lastCursor: currentCursor };
}

export function normalizeCard(card) {
  return {
    nm_id: card.nmID,
    vendor_code: card.vendorCode || '',
    brand: card.brand || null,
    title: card.title || null,
    description: card.description || null,
    category: card.category || null,
    subject: card.subject || null,
    characteristics: card.characteristics || [],
    sizes: card.sizes || [],
    photos: card.photos || [],
    video: card.video || null,
    dimensions: card.dimensions || {},
    weight: card.weight || null,
    updated_at: card.updatedAt,
  };
}

export async function testConnection() {
  try {
    const { cards } = await fetchCardsBatch(null, 1);
    return true;
  } catch {
    return false;
  }
}
