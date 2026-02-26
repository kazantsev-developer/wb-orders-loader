import pool from './connection.js';

export function normalizeRemainsData(reportData) {
  if (!Array.isArray(reportData)) {
    console.log('ошибка: ожидался массив, получено', typeof reportData);
    return [];
  }

  const flattened = [];

  for (const item of reportData) {
    const nmId = item.nmID || item.nmId || item.nm_id || 999999;

    const warehouses = item.warehouses || [];

    for (const wh of warehouses) {
      flattened.push({
        nmId: nmId,
        size: item.size || item.techSize || '',
        warehouse: wh.warehouseName || 'Неизвестный склад',
        quantity: Number(wh.quantity) || 0,
        barcode: item.barcode || null,
      });
    }
  }

  console.log(
    `развернуто записей: из ${reportData.length} товаров -> ${flattened.length} остатков`,
  );
  return flattened;
}

export async function upsertRemainsBatch(remainsData) {
  if (!remainsData || remainsData.length === 0) {
    return { count: 0 };
  }

  const client = await pool.connect();
  let successCount = 0;

  try {
    await client.query('BEGIN');

    for (const item of remainsData) {
      const query = `
        INSERT INTO wb_remains (
          nm_id, size, warehouse, quantity, barcode
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (nm_id, warehouse, size) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          barcode = EXCLUDED.barcode
      `;

      const values = [
        item.nmId,
        item.size,
        item.warehouse,
        item.quantity,
        item.barcode,
      ];

      await client.query(query, values);
      successCount++;
    }

    await client.query('COMMIT');
    return { count: successCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ошибка при сохранении остатков:', error.message);
    throw error;
  } finally {
    client.release();
  }
}
