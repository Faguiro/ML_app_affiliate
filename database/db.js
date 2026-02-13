// database/db.js
import Database from "better-sqlite3";
import { config } from "../core/config.js";
import { log } from "../core/logger.js";
import fs from "fs";
import path from "path";

class DatabaseManager {
  constructor() {
    this.dbPath = config.dbPath;
    this.initDatabase();
  }

  initDatabase() {
    try {
      // Criar diretório se não existir
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Conectar ao banco
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");

      // Executar schema
      const schemaPath = path.join(dbDir, "schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, "utf8");
        this.db.exec(schema);
        this.db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_original_url ON tracked_links(original_url)`,
        );
        log.info("Banco de dados inicializado");
      } else {
        log.warn("Schema não encontrado, criando tabelas básicas...");
        this.createTables();
      }
    } catch (error) {
      log.error("Erro ao inicializar banco de dados", error);
      throw error;
    }
  }

  createTables() {
    const tables = `
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
        `;

    this.db.exec(tables);
    log.info("Tabelas criadas com sucesso");
  }

  // Métodos de conveniência
  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  // Métodos específicos
  canSendToGroup(groupJid) {
    return true;
    console.log(`🔍 Verificando grupo ${groupJid}`);

    const group = this.get(
      `SELECT * FROM target_groups 
         WHERE group_jid = ? AND is_active = 1`,
      [groupJid],
    );

    if (!group) {
      console.log(`❌ Grupo ${groupJid} não encontrado ou inativo`);
      return false;
    }

    console.log(`📊 Grupo encontrado: ${group.group_name}`);
    console.log(
      `   sent_today: ${group.sent_today}, daily_limit: ${group.daily_limit}`,
    );
    console.log(
      `   last_reset: ${group.last_reset}, last_sent: ${group.last_sent}`,
    );

    // Reset diário se necessário
    const today = new Date().toISOString().split("T")[0];
    console.log(`📅 Hoje é: ${today}`);

    if (group.last_reset !== today) {
      console.log(`🔄 Resetando contador diário para ${group.group_name}`);
      this.run(
        `UPDATE target_groups 
             SET sent_today = 0, last_reset = date('now') 
             WHERE id = ?`,
        [group.id],
      );
      group.sent_today = 0;
    }

    // Verificar limite diário
    if (group.sent_today >= group.daily_limit) {
      console.log(
        `🚫 Grupo ${group.group_name} atingiu limite diário: ${group.sent_today}/${group.daily_limit}`,
      );
      return false;
    }

    // Verificar intervalo mínimo - CORRIGIDO
    if (group.last_sent) {
      // Converter last_sent para objeto Date corretamente
      const lastSent = new Date(group.last_sent);
      const now = new Date();

      // Calcular diferença em segundos CORRETAMENTE
      const diffSeconds = Math.floor(
        (now.getTime() - lastSent.getTime()) / 1000,
      );

      console.log(`⏱️  Último envio: ${lastSent.toISOString()}`);
      console.log(`   Agora: ${now.toISOString()}`);
      console.log(
        `   Diferença: ${diffSeconds} segundos, min_interval: ${group.min_interval}`,
      );

      if (diffSeconds < group.min_interval) {
        const waitSeconds = group.min_interval - diffSeconds;
        console.log(
          `⏸️  Aguardar: ${waitSeconds}s restantes (${Math.floor(waitSeconds / 60)} minutos)`,
        );
        return false;
      }
    }

    console.log(`✅ Grupo ${group.group_name} pode receber envio`);
    return true;
  }

  incrementSentCount(groupJid) {
    this.run(
      `UPDATE target_groups 
             SET sent_today = sent_today + 1, last_sent = datetime('now')
             WHERE group_jid = ?`,
      [groupJid],
    );
  }

  fetchAndLockLinks(limit = 5) {
    const transaction = this.db.transaction(() => {
      // 1️⃣ Buscar IDs prontos
      const rows = this.db
        .prepare(
          `
            SELECT id 
            FROM tracked_links
            WHERE status = 'ready'
            ORDER BY processed_at ASC
            LIMIT ?
        `,
        )
        .all(limit);

      if (!rows.length) return [];

      const ids = rows.map((r) => r.id);

      // 2️⃣ Marcar como sending (lock lógico)
      const placeholders = ids.map(() => "?").join(",");

      this.db
        .prepare(
          `
            UPDATE tracked_links
            SET status = 'sending'
            WHERE id IN (${placeholders})
        `,
        )
        .run(...ids);

      // 3️⃣ Retornar já travados
      return this.db
        .prepare(
          `
            SELECT *
            FROM tracked_links
            WHERE id IN (${placeholders})
        `,
        )
        .all(...ids);
    });

    return transaction();
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// Singleton
export const db = new DatabaseManager();
