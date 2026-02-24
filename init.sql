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

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_wb_orders_updated_at ON wb_orders;
CREATE TRIGGER update_wb_orders_updated_at
    BEFORE UPDATE ON wb_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

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
COMMENT ON TABLE sync_logs IS 'Логи синхронизации с Wildberries API';

CREATE TABLE IF NOT EXISTS wb_remains (
    nm_id INTEGER NOT NULL,
    size VARCHAR(50) NOT NULL,
    warehouse VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    barcode VARCHAR(50),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nm_id, warehouse, size)
);
COMMENT ON TABLE wb_remains IS 'остатки товаров на складах WB';

CREATE INDEX IF NOT EXISTS idx_wb_remains_warehouse ON wb_remains(warehouse);
CREATE INDEX IF NOT EXISTS idx_wb_remains_updated ON wb_remains(updated_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'обновить_время_изменения_остатков'
    ) THEN
        CREATE TRIGGER update_wb_remains_updated_at
            BEFORE UPDATE ON wb_remains
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;