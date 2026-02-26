import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

import pool from './src/db/connection.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(compression());
app.use(morgan('combined'));
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://5.129.206.60',
    ],
    credentials: true,
  }),
);
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    services: {
      postgres: true,
      api: true,
    },
  });
});

app.get('/api/wb/orders', async (req, res) => {
  try {
    const { from, to, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT * FROM wb_orders 
      WHERE 1=1
    `;
    const params = [];

    if (from) {
      params.push(from);
      query += ` AND date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND date <= $${params.length}`;
    }

    query += ` ORDER BY date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wb_orders',
    );

    res.json({
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    console.error('error fetching WB orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wb/orders/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN is_cancel THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(total_price) as total_revenue,
        COUNT(DISTINCT nm_id) as unique_products,
        MIN(date) as first_order,
        MAX(date) as last_order
      FROM wb_orders
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('error fetching WB stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wb/remains', async (req, res) => {
  try {
    const { warehouse, search } = req.query;

    let query = `
      SELECT * FROM wb_remains 
      WHERE 1=1
    `;
    const params = [];

    if (warehouse) {
      params.push(warehouse);
      query += ` AND warehouse = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (nm_id::text LIKE $${params.length} OR barcode LIKE $${params.length})`;
    }

    query += ` ORDER BY warehouse, nm_id`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching WB remains:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wb/cards', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT * FROM wb_cards 
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (vendor_code ILIKE $${params.length} OR title ILIKE $${params.length} OR brand ILIKE $${params.length})`;
    }

    query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wb_cards',
    );

    res.json({
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    console.error('error fetching WB cards:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ozon/orders', async (req, res) => {
  try {
    const { scheme, status, from, to, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT * FROM ozon_orders 
      WHERE 1=1
    `;
    const params = [];

    if (scheme) {
      params.push(scheme);
      query += ` AND scheme = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (from) {
      params.push(from);
      query += ` AND created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND created_at <= $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM ozon_orders',
    );

    res.json({
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    console.error('error fetching Ozon orders:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ozon/remains', async (req, res) => {
  try {
    const { brand, search } = req.query;

    let query = `
      SELECT * FROM ozon_remains 
      WHERE 1=1
    `;
    const params = [];

    if (brand) {
      params.push(brand);
      query += ` AND brand = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (item_code ILIKE $${params.length} OR name ILIKE $${params.length})`;
    }

    query += ` ORDER BY fbo_visible_amount DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching Ozon remains:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moysklad/stocks', async (req, res) => {
  try {
    const { product_uuid, store_uuid } = req.query;

    let query = `
      SELECT 
        msd.*,
        p.article,
        p.name as product_name,
        s.name as store_name
      FROM ms_stock_details msd
      LEFT JOIN ms_product_totals p ON msd.product_uuid = p.product_uuid
      LEFT JOIN ms_stores s ON msd.store_uuid = s.uuid
      WHERE 1=1
    `;
    const params = [];

    if (product_uuid) {
      params.push(product_uuid);
      query += ` AND msd.product_uuid = $${params.length}`;
    }
    if (store_uuid) {
      params.push(store_uuid);
      query += ` AND msd.store_uuid = $${params.length}`;
    }

    query += ` ORDER BY msd.snapshot_id DESC LIMIT 1000`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching Moysklad stocks:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moysklad/aggregates', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM ms_product_totals 
      ORDER BY total_stock DESC 
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching Moysklad aggregates:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/moysklad/stores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ms_stores ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching Moysklad stores:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync/logs', async (req, res) => {
  try {
    const { entity, limit = 50 } = req.query;

    let query = `
      SELECT * FROM sync_logs 
      WHERE 1=1
    `;
    const params = [];

    if (entity) {
      params.push(entity);
      query += ` AND entity_type = $${params.length}`;
    }

    query += ` ORDER BY sync_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching sync logs:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM wb_orders'),
      pool.query('SELECT COUNT(*) as count FROM ozon_orders'),
      pool.query('SELECT COUNT(*) as count FROM wb_remains'),
      pool.query('SELECT COUNT(*) as count FROM ozon_remains'),
      pool.query('SELECT COUNT(*) as count FROM wb_cards'),
      pool.query('SELECT SUM(total_stock) as total FROM ms_product_totals'),
      pool.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
        FROM sync_logs 
        WHERE sync_at > NOW() - INTERVAL '24 hours'
      `),
    ]);

    res.json({
      wb: {
        orders: parseInt(stats[0].rows[0].count),
        remains: parseInt(stats[2].rows[0].count),
        cards: parseInt(stats[4].rows[0].count),
      },
      ozon: {
        orders: parseInt(stats[1].rows[0].count),
        remains: parseInt(stats[3].rows[0].count),
      },
      moysklad: {
        total_stock: parseInt(stats[5].rows[0]?.total || 0),
      },
      sync: {
        last_24h: parseInt(stats[6].rows[0].total),
        success_rate:
          stats[6].rows[0].total > 0
            ? Math.round(
                (stats[6].rows[0].success / stats[6].rows[0].total) * 100,
              )
            : 0,
      },
    });
  } catch (error) {
    console.error('error fetching dashboard stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/charts/orders-daily', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const query = `
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - $1::integer,
          CURRENT_DATE - 1,
          '1 day'::interval
        )::date AS date
      )
      SELECT 
        d.date,
        COALESCE(wb.count, 0) as wb_orders,
        COALESCE(ozon.count, 0) as ozon_orders
      FROM dates d
      LEFT JOIN (
        SELECT DATE(date) as day, COUNT(*) as count
        FROM wb_orders
        WHERE date >= CURRENT_DATE - $1::integer
        GROUP BY DATE(date)
      ) wb ON d.date = wb.day
      LEFT JOIN (
        SELECT DATE(created_at) as day, COUNT(*) as count
        FROM ozon_orders
        WHERE created_at >= CURRENT_DATE - $1::integer
        GROUP BY DATE(created_at)
      ) ozon ON d.date = ozon.day
      ORDER BY d.date
    `;

    const result = await pool.query(query, [days]);
    res.json(result.rows);
  } catch (error) {
    console.error('error fetching chart data:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
  console.log(`api available at http://localhost:${PORT}/api`);
  console.log(`health check: http://localhost:${PORT}/api/health`);
});
