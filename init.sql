-- WB
CREATE TABLE IF NOT EXISTS wb_orders (
    srid VARCHAR(100) PRIMARY KEY,
    g_number VARCHAR(50) NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    last_change_date TIMESTAMP WITH TIME ZONE NOT NULL,
    supplier_article VARCHAR(100),
    tech_size VARCHAR(20),
    barcode VARCHAR(50),
    total_price NUMERIC(12, 2),
    discount_percent INTEGER,
    warehouse_name VARCHAR(100),
    is_cancel BOOLEAN DEFAULT FALSE,
    dest_city_name VARCHAR(100),
    country_name VARCHAR(100),
    oblast_okrug_name VARCHAR(255),
    region_name VARCHAR(255),
    nm_id INTEGER,
    category VARCHAR(100),
    brand VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wb_orders_date ON wb_orders(date);
CREATE INDEX IF NOT EXISTS idx_wb_orders_last_change ON wb_orders(last_change_date);
COMMENT ON TABLE wb_orders IS 'заказы из WB API';

-- WB остатки
CREATE TABLE IF NOT EXISTS wb_remains (
    nm_id INTEGER NOT NULL,
    size VARCHAR(50) NOT NULL,
    warehouse VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    barcode VARCHAR(50),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nm_id, warehouse, size)
);
CREATE INDEX IF NOT EXISTS idx_wb_remains_warehouse ON wb_remains(warehouse);
CREATE INDEX IF NOT EXISTS idx_wb_remains_updated ON wb_remains(updated_at DESC);
COMMENT ON TABLE wb_remains IS 'остатки товаров на складах WB';

-- мой склад
CREATE TABLE IF NOT EXISTS ms_stores (
    uuid VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    external_code VARCHAR(100),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ms_stores_name ON ms_stores(name);
CREATE INDEX IF NOT EXISTS idx_ms_stores_code ON ms_stores(code);
COMMENT ON TABLE ms_stores IS 'мой склад: справочник складов (store)';

CREATE TABLE IF NOT EXISTS ms_snapshots (
    id SERIAL PRIMARY KEY,
    collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ms_snapshots_collected ON ms_snapshots(collected_at DESC);
COMMENT ON TABLE ms_snapshots IS 'мой склад: снимки данных при каждой синхронизации';

CREATE TABLE IF NOT EXISTS ms_stock_details (
    id BIGSERIAL,
    snapshot_id INTEGER NOT NULL,
    product_uuid VARCHAR(100) NOT NULL,
    store_uuid VARCHAR(100) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    reserve INTEGER NOT NULL DEFAULT 0,
    in_transit INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (snapshot_id, product_uuid, store_uuid),
    FOREIGN KEY (snapshot_id) REFERENCES ms_snapshots(id) ON DELETE CASCADE,
    FOREIGN KEY (store_uuid) REFERENCES ms_stores(uuid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ms_details_product ON ms_stock_details(product_uuid);
CREATE INDEX IF NOT EXISTS idx_ms_details_store ON ms_stock_details(store_uuid);
COMMENT ON TABLE ms_stock_details IS 'мой склад: детальные остатки по складам (на каждый снимок)';

CREATE TABLE IF NOT EXISTS ms_product_totals (
    product_uuid VARCHAR(100) PRIMARY KEY,
    article VARCHAR(255),
    name TEXT,
    total_stock INTEGER NOT NULL DEFAULT 0,
    total_reserve INTEGER NOT NULL DEFAULT 0,
    total_in_transit INTEGER NOT NULL DEFAULT 0,
    snapshot_id INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (snapshot_id) REFERENCES ms_snapshots(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ms_totals_article ON ms_product_totals(article);
CREATE INDEX IF NOT EXISTS idx_ms_totals_updated ON ms_product_totals(updated_at DESC);
COMMENT ON TABLE ms_product_totals IS 'мой склад: агрегированные остатки по товарам (сумма по всем складам)';

CREATE TABLE IF NOT EXISTS ms_job_log (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL,
    records_count INTEGER DEFAULT 0,
    details_count INTEGER DEFAULT 0,
    aggregates_count INTEGER DEFAULT 0,
    error_message TEXT,
    execution_time_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ms_job_log_started ON ms_job_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ms_job_log_status ON ms_job_log(status);
COMMENT ON TABLE ms_job_log IS 'мой склад: логи синхронизации';

CREATE TABLE IF NOT EXISTS sync_logs (
    id SERIAL PRIMARY KEY,
    sync_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL,
    records_count INTEGER DEFAULT 0,
    date_from TIMESTAMP WITH TIME ZONE,
    date_to TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    pages_count INTEGER DEFAULT 0,
    execution_time_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_at ON sync_logs(sync_at DESC);
COMMENT ON TABLE sync_logs IS 'логи синхронизации с Wildberries API';

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_wb_orders_updated_at ON wb_orders;
CREATE TRIGGER update_wb_orders_updated_at
    BEFORE UPDATE ON wb_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wb_remains_updated_at ON wb_remains;
CREATE TRIGGER update_wb_remains_updated_at
    BEFORE UPDATE ON wb_remains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ms_product_totals_updated_at ON ms_product_totals;
CREATE TRIGGER update_ms_product_totals_updated_at
    BEFORE UPDATE ON ms_product_totals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ms_stores_updated_at ON ms_stores;
CREATE TRIGGER update_ms_stores_updated_at
    BEFORE UPDATE ON ms_stores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();