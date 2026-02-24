import pool from './connection.js';

function extractUuidFromMeta(meta) {
  if (!meta || !meta.href) return null;
  const parts = meta.href.split('/');
  return parts[parts.length - 1] || null;
}

export async function upsertStores(stores) {
  if (!stores || stores.length === 0) {
    return { count: 0 };
  }

  const client = await pool.connect();
  let successCount = 0;

  try {
    await client.query('BEGIN');

    for (const store of stores) {
      const uuid = store.id || extractUuidFromMeta(store.meta);

      if (!uuid) {
        console.warn('пропуск склада: не удалось извлечь uuid', store);
        continue;
      }

      const query = `
        INSERT INTO ms_stores (
          uuid, name, code, external_code, address, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (uuid) DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          external_code = EXCLUDED.external_code,
          address = EXCLUDED.address,
          updated_at = EXCLUDED.updated_at
      `;

      const values = [
        uuid,
        store.name || null,
        store.code || null,
        store.externalCode || null,
        store.address || null,
        store.created ? new Date(store.created) : new Date(),
        store.updated ? new Date(store.updated) : new Date(),
      ];

      await client.query(query, values);
      successCount++;
    }

    await client.query('COMMIT');
    return { count: successCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ошибка при сохранении складов:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function createSnapshot() {
  const query = `
    INSERT INTO ms_snapshots (collected_at)
    VALUES (CURRENT_TIMESTAMP)
    RETURNING id
  `;

  try {
    const result = await pool.query(query);
    return result.rows[0].id;
  } catch (error) {
    console.error('ошибка создания снимка:', error.message);
    throw error;
  }
}

export async function insertStockDetailsBatch(stockDetails) {
  if (!stockDetails || stockDetails.length === 0) {
    return { count: 0 };
  }

  const client = await pool.connect();
  let successCount = 0;

  try {
    await client.query('BEGIN');

    const batchSize = 1000;
    for (let i = 0; i < stockDetails.length; i += batchSize) {
      const batch = stockDetails.slice(i, i + batchSize);

      const values = [];
      const placeholders = [];

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const baseIndex = j * 6;
        placeholders.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`,
        );

        values.push(
          item.snapshot_id,
          item.product_uuid,
          item.store_uuid,
          item.stock,
          item.reserve,
          item.in_transit,
        );
      }

      const query = `
        INSERT INTO ms_stock_details (
          snapshot_id, product_uuid, store_uuid, stock, reserve, in_transit
        ) VALUES ${placeholders.join(', ')}
      `;

      await client.query(query, values);
      successCount += batch.length;
    }

    await client.query('COMMIT');
    return { count: successCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ошибка при сохранении детальных остатков:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertProductAggregates(aggregates) {
  if (!aggregates || aggregates.length === 0) {
    return { count: 0 };
  }

  const client = await pool.connect();
  let successCount = 0;

  try {
    await client.query('BEGIN');

    for (const item of aggregates) {
      const query = `
        INSERT INTO ms_product_totals (
          product_uuid, article, name, total_stock, total_reserve, total_in_transit, snapshot_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (product_uuid) DO UPDATE SET
          article = EXCLUDED.article,
          name = EXCLUDED.name,
          total_stock = EXCLUDED.total_stock,
          total_reserve = EXCLUDED.total_reserve,
          total_in_transit = EXCLUDED.total_in_transit,
          snapshot_id = EXCLUDED.snapshot_id,
          updated_at = CURRENT_TIMESTAMP
      `;

      const values = [
        item.product_uuid,
        item.article,
        item.name,
        item.total_stock,
        item.total_reserve,
        item.total_in_transit,
        item.snapshot_id,
      ];

      await client.query(query, values);
      successCount++;
    }

    await client.query('COMMIT');
    return { count: successCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ошибка при сохранении агрегатов:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertJobLog(logData) {
  const query = `
    INSERT INTO ms_job_log (
      status, records_count, details_count, aggregates_count,
      error_message, execution_time_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `;

  const values = [
    logData.status,
    logData.recordsCount || 0,
    logData.detailsCount || 0,
    logData.aggregatesCount || 0,
    logData.errorMessage || null,
    logData.executionTimeSeconds || 0,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0].id;
  } catch (error) {
    console.error('ошибка записи лога:', error.message);
    throw error;
  }
}
