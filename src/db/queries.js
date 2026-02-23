import pool from './connection.js';

export async function upsertOrdersBatch(orders) {
  if (orders.length === 0) return { count: 0 };

  const client = await pool.connect();
  let successCount = 0;

  try {
    await client.query('BEGIN');

    for (const order of orders) {
      const query = `
        INSERT INTO wb_orders (
          srid, g_number, date, last_change_date, supplier_article,
          tech_size, barcode, total_price, discount_percent, warehouse_name,
          is_cancel, dest_city_name, country_name, oblast_okrug_name,
          region_name, nm_id, category, brand
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (srid) DO UPDATE SET
          last_change_date = EXCLUDED.last_change_date,
          is_cancel = EXCLUDED.is_cancel,
          total_price = EXCLUDED.total_price
      `;

      const values = [
        order.srid,
        order.gNumber,
        order.date,
        order.lastChangeDate,
        order.supplierArticle || null,
        order.techSize || null,
        order.barcode || null,
        order.totalPrice || 0,
        order.discountPercent || 0,
        order.warehouseName || null,
        order.isCancel || false,
        order.destCityName || null,
        order.countryName || null,
        order.oblastOkrugName || null,
        order.regionName || null,
        order.nmId || null,
        order.category || null,
        order.brand || null,
      ];

      await client.query(query, values);
      successCount++;
    }

    await client.query('COMMIT');
    return { count: successCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при сохранении заказов:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertSyncLog(logData) {
  const query = `
    INSERT INTO sync_logs (
      status, records_count, date_from, date_to,
      error_message, pages_count, execution_time_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `;

  const values = [
    logData.status,
    logData.recordsCount || 0,
    logData.dateFrom,
    logData.dateTo,
    logData.errorMessage || null,
    logData.pagesCount || 0,
    logData.executionTimeSeconds || 0,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0].id;
  } catch (error) {
    console.error('Ошибка записи лога:', error.message);
    throw error;
  }
}

export async function getLastSyncStats(limit = 5) {
  const query = `
    SELECT * FROM sync_logs 
    ORDER BY sync_at DESC 
    LIMIT $1
  `;

  try {
    const result = await pool.query(query, [limit]);
    return result.rows;
  } catch (error) {
    console.error('Ошибка получения статистики:', error.message);
    return [];
  }
}
