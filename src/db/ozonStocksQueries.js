import pool from './connection.js';

export async function upsertStocksBatch(stocks) {
  if (!stocks || stocks.length === 0) {
    return { count: 0, errors: [] };
  }

  const client = await pool.connect();
  let totalSuccess = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    const batchSize = 100;
    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);

      try {
        const values = [];
        const placeholders = [];

        for (let j = 0; j < batch.length; j++) {
          const stock = batch[j];
          const offset = j * 8;

          values.push(
            stock.sku,
            stock.product_id,
            stock.item_code,
            stock.category,
            stock.brand,
            stock.name,
            stock.fbo_visible_amount,
            stock.fbo_present_amount,
          );

          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, CURRENT_TIMESTAMP)`,
          );
        }

        const query = `
          INSERT INTO ozon_remains (
            sku, product_id, item_code, category, brand, name,
            fbo_visible_amount, fbo_present_amount, synced_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (sku) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            item_code = EXCLUDED.item_code,
            category = EXCLUDED.category,
            brand = EXCLUDED.brand,
            name = EXCLUDED.name,
            fbo_visible_amount = EXCLUDED.fbo_visible_amount,
            fbo_present_amount = EXCLUDED.fbo_present_amount,
            synced_at = CURRENT_TIMESTAMP
          RETURNING sku
        `;

        const result = await client.query(query, values);
        totalSuccess += result.rowCount;

        await client.query('COMMIT');
        await client.query('BEGIN');
      } catch (error) {
        console.error(
          `[OzonStocksDB] ошибка при сохранении пачки ${i / batchSize + 1}:`,
          error.message,
        );
        batch.forEach((stock) => {
          errors.push({
            sku: stock.sku,
            error: error.message,
          });
        });
        await client.query('ROLLBACK');
        await client.query('BEGIN');
      }

      console.log(
        `[OzonStocksDB] обработано ${Math.min(i + batchSize, stocks.length)}/${stocks.length} записей`,
      );
    }

    await client.query('COMMIT');

    console.log(
      `[OzonStocksDB] успешно сохранено ${totalSuccess} записей, ошибок: ${errors.length}`,
    );

    return {
      count: totalSuccess,
      errors: errors,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(
      '[OzonStocksDB] критическая ошибка при сохранении остатков:',
      error.message,
    );
    throw error;
  } finally {
    client.release();
  }
}

export async function resetStaleStocks(syncStartTime) {
  try {
    const query = `
      UPDATE ozon_remains 
      SET 
        fbo_visible_amount = 0,
        fbo_present_amount = 0,
        synced_at = CURRENT_TIMESTAMP
      WHERE synced_at < $1
      RETURNING sku
    `;

    const result = await pool.query(query, [syncStartTime]);

    if (result.rowCount > 0) {
      console.log(
        `[OzonStocksDB] обнулено устаревших остатков: ${result.rowCount}`,
      );
    }

    return result.rowCount;
  } catch (error) {
    console.error(
      '[OzonStocksDB] ошибка при обнулении остатков:',
      error.message,
    );
    throw error;
  }
}

export async function insertStocksLog(logData) {
  const query = `
    INSERT INTO ozon_sync_logs (
      status, scheme, records_count, 
      date_from, date_to, error_message, 
      execution_time_ms
    ) VALUES ($1, 'stocks', $2, $3, $4, $5, $6)
    RETURNING id
  `;

  const values = [
    logData.status,
    logData.recordsCount || 0,
    logData.dateFrom || null,
    logData.dateTo || null,
    logData.errorMessage || null,
    logData.executionTimeMs || 0,
  ];

  try {
    const result = await pool.query(query, values);
    console.log(`[OzonStocksDB] лог сохранен, id: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error('[OzonStocksDB] ошибка записи лога:', error.message);
    throw error;
  }
}

export async function getStocksStats() {
  try {
    const queries = {
      total: 'SELECT COUNT(*) as count FROM ozon_remains',
      total_amount:
        'SELECT SUM(fbo_visible_amount) as total_visible, SUM(fbo_present_amount) as total_present FROM ozon_remains',
      by_brand: `
        SELECT brand, COUNT(*) as products, SUM(fbo_visible_amount) as visible 
        FROM ozon_remains 
        WHERE brand IS NOT NULL 
        GROUP BY brand 
        ORDER BY visible DESC 
        LIMIT 10
      `,
      updated_last_hour: `
        SELECT COUNT(*) as count 
        FROM ozon_remains 
        WHERE updated_at > NOW() - INTERVAL '1 hour'
      `,
      last_sync: `
        SELECT * FROM ozon_sync_logs 
        WHERE scheme = 'stocks' 
        ORDER BY sync_at DESC 
        LIMIT 1
      `,
    };

    const [total, amounts, byBrand, updated, lastSync] = await Promise.all([
      pool.query(queries.total),
      pool.query(queries.total_amount),
      pool.query(queries.by_brand),
      pool.query(queries.updated_last_hour),
      pool.query(queries.last_sync),
    ]);

    return {
      total_products: parseInt(total.rows[0].count),
      total_visible: parseInt(amounts.rows[0].total_visible) || 0,
      total_present: parseInt(amounts.rows[0].total_present) || 0,
      top_brands: byBrand.rows,
      updated_last_hour: parseInt(updated.rows[0].count),
      last_sync: lastSync.rows[0] || null,
    };
  } catch (error) {
    console.error('[OzonStocksDB] ошибка получения статистики:', error.message);
    return null;
  }
}

export async function stockExists(sku) {
  try {
    const query = 'SELECT 1 FROM ozon_remains WHERE sku = $1';
    const result = await pool.query(query, [sku]);
    return result.rowCount > 0;
  } catch (error) {
    console.error('[OzonStocksDB] ошибка проверки остатка:', error.message);
    return false;
  }
}

export async function cleanupOldLogs(daysToKeep = 30) {
  try {
    const query = `
      DELETE FROM ozon_sync_logs 
      WHERE scheme = 'stocks' 
        AND sync_at < NOW() - INTERVAL '1 day' * $1
      RETURNING id
    `;

    const result = await pool.query(query, [daysToKeep]);
    console.log(`[OzonStocksDB] удалено старых логов: ${result.rowCount}`);
    return result.rowCount;
  } catch (error) {
    console.error('[OzonStocksDB] ошибка при очистке логов:', error.message);
    return 0;
  }
}
