import sqlite3
import csv
import os

DB_PATH = '../database/affiliate.db'
CSV_PATH = 'message_log.csv'

def migrate():
    print("🚀 Iniciando migração de CSV para SQLite...")
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Criar a nova tabela estruturada
    c.execute('''
    CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        sender TEXT,
        chat_id TEXT,
        status TEXT, -- 'SUCCESS' ou 'FAILED'
        message_preview TEXT,
        error_message TEXT
    )
    ''')
    
    # Índices para o Dashboard voar baixo
    c.execute('CREATE INDEX IF NOT EXISTS idx_logs_status ON message_logs(status)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON message_logs(timestamp)')
    
    # 2. Importar dados do CSV
    if os.path.exists(CSV_PATH):
        with open(CSV_PATH, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            count = 0
            for row in reader:
                try:
                    c.execute('''
                        INSERT INTO message_logs (timestamp, sender, chat_id, status, message_preview, error_message)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', (
                        row['timestamp'], 
                        row['sender'], 
                        row['chat_id'], 
                        row['status'], 
                        row['message_preview'], 
                        row.get('error', '') # Usa .get caso a coluna mude de nome
                    ))
                    count += 1
                except Exception as e:
                    print(f"⚠️ Erro na linha {count}: {e}")
            
            print(f"✅ Sucesso! {count} logs migrados para o banco de dados.")
    else:
        print("ℹ️ Arquivo CSV não encontrado, apenas tabela criada.")

    conn.commit()
    conn.close()

if __name__ == '__main__':
    migrate()
