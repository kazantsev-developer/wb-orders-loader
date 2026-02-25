import pool from './connection.js';

export async function upsertCardsBatch(cards) {
  if (!cards || cards.length === 0) {
    return { count: 0, errors: [] };
  }

  const client = await pool.connect();
  let successCount = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    const batchSize = 100;
    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);

      for (const card of batch) {
        try {
          const query = `
            INSERT INTO wb_cards (
              nm_id, vendor_code, brand, title, description,
              category, subject, characteristics, sizes, photos,
              video, dimensions, weight, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (nm_id) DO UPDATE SET
              vendor_code = EXCLUDED.vendor_code,
              brand = EXCLUDED.brand,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              category = EXCLUDED.category,
              subject = EXCLUDED.subject,
              characteristics = EXCLUDED.characteristics,
              sizes = EXCLUDED.sizes,
              photos = EXCLUDED.photos,
              video = EXCLUDED.video,
              dimensions = EXCLUDED.dimensions,
              weight = EXCLUDED.weight,
              updated_at = EXCLUDED.updated_at,
              synced_at = CURRENT_TIMESTAMP
          `;

          const values = [
            card.nm_id,
            card.vendor_code,
            card.brand,
            card.title,
            card.description,
            card.category,
            card.subject,
            JSON.stringify(card.characteristics || []),
            JSON.stringify(card.sizes || []),
            JSON.stringify(card.photos || []),
            card.video,
            JSON.stringify(card.dimensions || {}),
            card.weight,
            card.updated_at,
          ];

          await client.query(query, values);
          successCount++;
        } catch (error) {
          errors.push({
            nm_id: card.nm_id,
            error: error.message,
          });
        }
      }
    }

    await client.query('COMMIT');

    return { count: successCount, errors };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CardsDB] ошибка при сохранении карточек:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function saveCursorState(updatedAt, nmId) {
  if (!updatedAt || !nmId) {
    return;
  }

  try {
    const query = `
      UPDATE sync_cursor_state 
      SET last_updated_at = $1, last_nm_id = $2
      WHERE id = 1
    `;

    await pool.query(query, [updatedAt, nmId]);
  } catch (error) {
    console.error('[CardsDB] ошибка при сохранении курсора:', error.message);
    throw error;
  }
}

export async function getLastCursor() {
  try {
    const query = `
      SELECT last_updated_at, last_nm_id
      FROM sync_cursor_state
      WHERE id = 1
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0 || !result.rows[0].last_updated_at) {
      return null;
    }

    const updatedAt = result.rows[0].last_updated_at;
    const isoString =
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : new Date(updatedAt).toISOString();

    return {
      updatedAt: isoString,
      nmID: parseInt(result.rows[0].last_nm_id, 10),
    };
  } catch (error) {
    console.error('[CardsDB] ошибка при получении курсора:', error.message);
    return null;
  }
}

export async function insertCardsLog(logData) {
  const query = `
    INSERT INTO sync_logs (
      status, records_count, date_from, date_to,
      error_message, pages_count, execution_time_seconds,
      entity_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `;

  const values = [
    logData.status,
    logData.recordsCount || 0,
    logData.dateFrom || null,
    logData.dateTo || null,
    logData.errorMessage || null,
    logData.pagesCount || 0,
    logData.executionTimeSeconds || 0,
    'cards',
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0].id;
  } catch (error) {
    console.error('[CardsDB] ошибка записи лога:', error.message);
    throw error;
  }
}

export async function getCardsStats() {
  try {
    const queries = {
      total: 'SELECT COUNT(*) as count FROM wb_cards',
      updated_last_hour: `
        SELECT COUNT(*) as count 
        FROM wb_cards 
        WHERE synced_at > NOW() - INTERVAL '1 hour'
      `,
      last_sync: `
        SELECT * FROM sync_logs 
        WHERE entity_type = 'cards' 
        ORDER BY sync_at DESC 
        LIMIT 1
      `,
      cursor: 'SELECT * FROM sync_cursor_state WHERE id = 1',
    };

    const [total, updated, lastSync, cursor] = await Promise.all([
      pool.query(queries.total),
      pool.query(queries.updated_last_hour),
      pool.query(queries.last_sync),
      pool.query(queries.cursor),
    ]);

    return {
      total_cards: parseInt(total.rows[0].count),
      updated_last_hour: parseInt(updated.rows[0].count),
      last_sync: lastSync.rows[0] || null,
      cursor: cursor.rows[0] || null,
    };
  } catch (error) {
    console.error('[CardsDB] ошибка получения статистики:', error.message);
    return null;
  }
}

export async function cleanupOldLogs(daysToKeep = 30) {
  try {
    const query = `
      DELETE FROM sync_logs 
      WHERE entity_type = 'cards' 
        AND sync_at < NOW() - INTERVAL '${daysToKeep} days'
    `;

    const result = await pool.query(query);
    return result.rowCount;
  } catch (error) {
    console.error('[CardsDB] ошибка при очистке логов:', error.message);
    return 0;
  }
}
