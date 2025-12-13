// scripts/setup.js
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function setup() {
    console.log('⚙️  Configuração do Bot de Afiliados\n');
    
    // Criar diretórios
    const dirs = ['./sessions', './database', './logs'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Criado: ${dir}`);
        }
    });
    
    // Configurar .env
    const envPath = path.join(process.cwd(), '.env');
    
    if (fs.existsSync(envPath)) {
        const overwrite = await question('.env já existe. Sobrescrever? (s/n): ');
        if (overwrite.toLowerCase() !== 's') {
            console.log('Configuração cancelada.');
            rl.close();
            return;
        }
    }
    
    const ownerNumber = await question('Número do dono (ex: 5511999999999): ');
    
    const envContent = `# WhatsApp
WHATSAPP_SESSION_PATH=./sessions
WHATSAPP_OWNER_NUMBER=${ownerNumber}

# Banco de Dados
DB_PATH=./database/affiliate.db

# API Externa
AFFILIATE_API_URL=https://grupossd.xyz
AFFILIATE_API_TIMEOUT=30000
AFFILIATE_MAX_RETRIES=3

# Sistema
PREFIX=#
ASSISTANT_ENABLED=true
BOT_ENABLED=true

# Agendamento
SCHEDULER_PROCESS_INTERVAL=300000
SCHEDULER_SEND_INTERVAL=600000

# Limites
MAX_LINKS_PER_GROUP_PER_DAY=5
MIN_INTERVAL_BETWEEN_MESSAGES=300

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
`;
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env configurado com sucesso!');
    
    // Criar schema
    const schemaPath = path.join(process.cwd(), 'database/schema.sql');
    const schemaContent = `-- database/schema.sql
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
    original_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    sender_name TEXT,
    status TEXT DEFAULT 'pending',
    affiliate_link TEXT,
    metadata TEXT,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
`;
    
    fs.writeFileSync(schemaPath, schemaContent);
    console.log('✅ Schema do banco criado!');
    
    console.log('\n🎉 Configuração concluída!');
    console.log('\nPróximos passos:');
    console.log('1. Execute: npm install');
    console.log('2. Execute: npm start');
    console.log('3. Escaneie o QR Code com seu WhatsApp');
    console.log('\nComandos disponíveis:');
    console.log('#admin help - Mostra todos os comandos');
    
    rl.close();
}

setup();