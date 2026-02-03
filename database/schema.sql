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
    copy_text TEXT,
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

CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        sender TEXT,
        chat_id TEXT,
        status TEXT, -- 'SUCCESS' ou 'FAILED'
        message_preview TEXT,
        error_message TEXT
);

-- CREATE INDEX IF NOT EXISTS idx_logs_status ON message_logs(status)
-- CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON message_logs(timestamp)


CREATE TABLE IF NOT EXISTS channel_cursor (
    group_id TEXT PRIMARY KEY,
    last_message_id INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de mensagens processadas (CRÍTICA - ESTAVA FALTANDO!)
CREATE TABLE IF NOT EXISTS processed_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    group_jid TEXT NOT NULL,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para tracked_links
CREATE INDEX IF NOT EXISTS idx_tracked_links_status 
ON tracked_links(status);

CREATE INDEX IF NOT EXISTS idx_tracked_links_created 
ON tracked_links(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracked_links_domain 
ON tracked_links(domain);

-- Índices para processed_messages
CREATE INDEX IF NOT EXISTS idx_processed_messages_id 
ON processed_messages(message_id);

CREATE INDEX IF NOT EXISTS idx_processed_messages_group 
ON processed_messages(group_jid);

-- Índices para affiliate_domains
CREATE INDEX IF NOT EXISTS idx_affiliate_domains_active 
ON affiliate_domains(is_active);

CREATE INDEX IF NOT EXISTS idx_tracked_links_status ON tracked_links(status);
CREATE INDEX IF NOT EXISTS idx_tracked_links_domain ON tracked_links(domain);
CREATE INDEX IF NOT EXISTS idx_target_groups_active ON target_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_sent_links_date ON sent_links(sent_at);
