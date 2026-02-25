import pool from './connection.js';

export async function upsertOzonOrdersBatch(orders, scheme) {
  if (!orders || orders.length === 0) {
    return { count: 0, errors: [] };
  }

  const client = await pool.connect();
  let successCount = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    const batchSize = 100;
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);

      for (const order of batch) {
        try {
          const query = `
            INSERT INTO ozon_orders (
              posting_number, order_id, order_number, status,
              delivery_method_id, tpl_integration_type,
              created_at, in_process_at, shipment_date, delivering_date,
              products, analytics_data, financial_data, scheme
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (posting_number) DO UPDATE SET
              status = EXCLUDED.status,
              products = EXCLUDED.products,
              analytics_data = EXCLUDED.analytics_data,
              financial_data = EXCLUDED.financial_data,
              updated_at = CURRENT_TIMESTAMP
            RETURNING posting_number
          `;

          const values = [
            order.posting_number,
            order.order_id,
            order.order_number,
            order.status,
            order.delivery_method_id,
            order.tpl_integration_type,
            order.created_at,
            order.in_process_at,
            order.shipment_date,
            order.delivering_date,
            JSON.stringify(order.products || []),
            JSON.stringify(order.analytics_data || {}),
            JSON.stringify(order.financial_data || {}),
            order.scheme || scheme,
          ];

          const result = await client.query(query, values);
          if (result.rowCount > 0) {
            successCount++;
          }
        } catch (error) {
          console.error(
            `[OzonDB] ошибка при сохранении заказа ${order.posting_number}:`,
            error.message,
          );
          errors.push({
            posting_number: order.posting_number,
            error: error.message,
          });
        }
      }

      console.log(
        `[OzonDB] обработано ${Math.min(i + batchSize, orders.length)}/${orders.length} заказов (${scheme})`,
      );
    }

    await client.query('COMMIT');

    console.log(
      `[OzonDB] успешно сохранено ${successCount} заказов ${scheme}, ошибок: ${errors.length}`,
    );

    return {
      count: successCount,
      errors: errors,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(
      '[OzonDB] критическая ошибка при сохранении заказов:',
      error.message,
    );
    throw error;
  } finally {
    client.release();
  }
}

export async function insertOzonLog(logData) {
  const query = `
    INSERT INTO ozon_sync_logs (
      status, scheme, records_count, 
      date_from, date_to, error_message, 
      execution_time_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `;

  const values = [
    logData.status,
    logData.scheme,
    logData.recordsCount || 0,
    logData.dateFrom || null,
    logData.dateTo || null,
    logData.errorMessage || null,
    logData.executionTimeMs || 0,
  ];

  try {
    const result = await pool.query(query, values);
    console.log(`[OzonDB] лог сохранен, id: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error('[OzonDB] ошибка записи лога:', error.message);
    throw error;
  }
}

export async function getOzonStats() {
  try {
    const queries = {
      total: 'SELECT COUNT(*) as count FROM ozon_orders',
      byScheme: `
        SELECT scheme, COUNT(*) as count 
        FROM ozon_orders 
        GROUP BY scheme
      `,
      updated_last_hour: `
        SELECT COUNT(*) as count 
        FROM ozon_orders 
        WHERE updated_at > NOW() - INTERVAL '1 hour'
      `,
      last_sync: `
        SELECT * FROM ozon_sync_logs 
        ORDER BY sync_at DESC 
        LIMIT 1
      `,
    };

    const [total, byScheme, updated, lastSync] = await Promise.all([
      pool.query(queries.total),
      pool.query(queries.byScheme),
      pool.query(queries.updated_last_hour),
      pool.query(queries.last_sync),
    ]);

    const schemeStats = {};
    byScheme.rows.forEach((row) => {
      schemeStats[row.scheme] = parseInt(row.count);
    });

    return {
      total_orders: parseInt(total.rows[0].count),
      by_scheme: schemeStats,
      updated_last_hour: parseInt(updated.rows[0].count),
      last_sync: lastSync.rows[0] || null,
    };
  } catch (error) {
    console.error('[OzonDB] ошибка получения статистики:', error.message);
    return null;
  }
}

export async function getOrdersByDateRange(dateFrom, dateTo, scheme = null) {
  try {
    let query = `
      SELECT * FROM ozon_orders 
      WHERE created_at BETWEEN $1 AND $2
    `;
    const params = [dateFrom, dateTo];

    if (scheme) {
      query += ` AND scheme = $3`;
      params.push(scheme);
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('[OzonDB] ошибка получения заказов:', error.message);
    return [];
  }
}

export async function cleanupOldLogs(daysToKeep = 30) {
  try {
    const query = `
      DELETE FROM ozon_sync_logs 
      WHERE sync_at < NOW() - INTERVAL '${daysToKeep} days'
      RETURNING id
    `;

    const result = await pool.query(query);
    console.log(`[OzonDB] удалено старых логов: ${result.rowCount}`);
    return result.rowCount;
  } catch (error) {
    console.error('[OzonDB] ошибка при очистке логов:', error.message);
    return 0;
  }
}

export async function orderExists(postingNumber) {
  try {
    const query = 'SELECT 1 FROM ozon_orders WHERE posting_number = $1';
    const result = await pool.query(query, [postingNumber]);
    return result.rowCount > 0;
  } catch (error) {
    console.error('[OzonDB] ошибка проверки заказа:', error.message);
    return false;
  }
}
