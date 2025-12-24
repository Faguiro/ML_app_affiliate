-- database/schema.sql
CREATE TABLE IF NOT EXISTS tracked_groups (
    id INTEGER PRIMARY KEY,
    group_jid TEXT UNIQUE NOT NULL,
    group_name TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS target_groups (
    id INTEGER PRIMARY KEY,
    group_jid TEXT UNIQUE NOT NULL,
    group_name TEXT,
    is_active BOOLEAN DEFAULT 1,
    daily_limit INTEGER DEFAULT 5,
    sent_today INTEGER DEFAULT 0,
    last_reset DATE DEFAULT CURRENT_DATE,
    min_interval INTEGER DEFAULT 300,
    last_sent TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliate_domains (
    id INTEGER PRIMARY KEY,
    domain TEXT UNIQUE NOT NULL,
    affiliate_code TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracked_links (
    id INTEGER PRIMARY KEY,
    original_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    sender_name TEXT,
    status TEXT DEFAULT 'pending',
    affiliate_link TEXT UNIQUE,  
    metadata TEXT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_sent (
    id INTEGER PRIMARY KEY,
    tracked_link_id INTEGER UNIQUE,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT 1,
    error_message TEXT,
    FOREIGN KEY (tracked_link_id) REFERENCES tracked_links(id)
);


CREATE TABLE IF NOT EXISTS sent_links (
    id INTEGER PRIMARY KEY,
    tracked_link_id INTEGER NOT NULL,
    target_group_jid TEXT NOT NULL,
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracked_links_status ON tracked_links(status);
CREATE INDEX IF NOT EXISTS idx_tracked_links_domain ON tracked_links(domain);
CREATE INDEX IF NOT EXISTS idx_target_groups_active ON target_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_sent_links_date ON sent_links(sent_at);
