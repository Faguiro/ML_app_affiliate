#!/usr/bin/env python3
"""
Script para configurar e validar o banco de dados do sistema de afiliados
Execute este script ANTES de iniciar o bot
"""
import sqlite3
import os
import sys
from datetime import datetime

def print_header(text):
    """Imprime cabeçalho formatado"""
    print("\n" + "="*70)
    print(f"  {text}")
    print("="*70)

def print_section(text):
    """Imprime seção formatada"""
    print(f"\n{'─'*70}")
    print(f"  {text}")
    print(f"{'─'*70}")

def check_database_exists(db_path):
    """Verifica se o banco de dados existe"""
    return os.path.exists(db_path)

def create_tables(conn):
    """Cria todas as tabelas necessárias"""
    cursor = conn.cursor()
    
    print_section("📋 Criando Tabelas")
    
    tables = {
        'tracked_links': '''
            CREATE TABLE IF NOT EXISTS tracked_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_url TEXT NOT NULL UNIQUE,
                domain TEXT NOT NULL,
                group_jid TEXT NOT NULL,
                sender_name TEXT,
                copy_text TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_at TIMESTAMP,
                error_message TEXT
            )
        ''',
        'processed_messages': '''
            CREATE TABLE IF NOT EXISTS processed_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL UNIQUE,
                group_jid TEXT NOT NULL,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''',
        'affiliate_domains': '''
            CREATE TABLE IF NOT EXISTS affiliate_domains (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL UNIQUE,
                affiliate_code TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''',
        'chat_preferences': '''
            CREATE TABLE IF NOT EXISTS chat_preferences (
                chat_id TEXT PRIMARY KEY,
                purpose TEXT CHECK(purpose IN ('destino', 'rastreio')),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        '''
    }
    
    for table_name, create_sql in tables.items():
        try:
            cursor.execute(create_sql)
            print(f"  ✅ Tabela '{table_name}' criada/verificada")
        except Exception as e:
            print(f"  ❌ Erro ao criar tabela '{table_name}': {e}")
            return False
    
    conn.commit()
    return True

def create_indexes(conn):
    """Cria índices para performance"""
    cursor = conn.cursor()
    
    print_section("⚡ Criando Índices")
    
    indexes = [
        ('idx_tracked_links_status', 'tracked_links', 'status'),
        ('idx_tracked_links_created', 'tracked_links', 'created_at DESC'),
        ('idx_tracked_links_domain', 'tracked_links', 'domain'),
        ('idx_processed_messages_id', 'processed_messages', 'message_id'),
        ('idx_processed_messages_group', 'processed_messages', 'group_jid'),
        ('idx_affiliate_domains_active', 'affiliate_domains', 'is_active'),
    ]
    
    for idx_name, table_name, column in indexes:
        try:
            cursor.execute(f'CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({column})')
            print(f"  ✅ Índice '{idx_name}' criado")
        except Exception as e:
            print(f"  ⚠️  Aviso ao criar índice '{idx_name}': {e}")
    
    conn.commit()

def test_table_operations(conn):
    """Testa operações básicas nas tabelas"""
    cursor = conn.cursor()
    
    print_section("🧪 Testando Operações")
    
    # Teste 1: processed_messages (CRÍTICO!)
    try:
        cursor.execute(
            "INSERT INTO processed_messages (message_id, group_jid) VALUES (?, ?)",
            ('test_msg_123', 'test_group_123')
        )
        conn.commit()
        
        cursor.execute("SELECT * FROM processed_messages WHERE message_id = ?", ('test_msg_123',))
        result = cursor.fetchone()
        
        if result:
            print("  ✅ processed_messages - INSERT/SELECT funcionando")
            cursor.execute("DELETE FROM processed_messages WHERE message_id = ?", ('test_msg_123',))
            conn.commit()
        else:
            print("  ❌ processed_messages - Falha no SELECT")
            
    except Exception as e:
        print(f"  ❌ processed_messages - Erro: {e}")
        return False
    
    # Teste 2: tracked_links
    try:
        test_url = f'https://test.com/product_{datetime.now().timestamp()}'
        cursor.execute(
            """INSERT INTO tracked_links 
               (original_url, domain, group_jid, status) 
               VALUES (?, ?, ?, ?)""",
            (test_url, 'test.com', 'test_group', 'pending')
        )
        conn.commit()
        
        cursor.execute("SELECT * FROM tracked_links WHERE original_url = ?", (test_url,))
        result = cursor.fetchone()
        
        if result:
            print("  ✅ tracked_links - INSERT/SELECT funcionando")
            cursor.execute("DELETE FROM tracked_links WHERE original_url = ?", (test_url,))
            conn.commit()
        else:
            print("  ❌ tracked_links - Falha no SELECT")
            
    except Exception as e:
        print(f"  ❌ tracked_links - Erro: {e}")
        return False
    
    return True

def check_affiliate_domains(conn):
    """Verifica domínios afiliados configurados"""
    cursor = conn.cursor()
    
    print_section("🌐 Domínios Afiliados")
    
    cursor.execute("SELECT domain, affiliate_code, is_active FROM affiliate_domains ORDER BY is_active DESC")
    domains = cursor.fetchall()
    
    if not domains:
        print("  ⚠️  ATENÇÃO: Nenhum domínio afiliado configurado!")
        print("\n  Execute no SQLite:")
        print("  INSERT INTO affiliate_domains (domain, affiliate_code, is_active)")
        print("  VALUES ('mercadolivre.com.br', 'SEU_CODIGO', 1);")
        return False
    
    active_count = 0
    for domain, code, is_active in domains:
        status = "✅ ATIVO" if is_active else "❌ INATIVO"
        print(f"  {status} - {domain} (código: {code})")
        if is_active:
            active_count += 1
    
    print(f"\n  📊 Total: {len(domains)} domínios ({active_count} ativos)")
    return active_count > 0

def show_statistics(conn):
    """Mostra estatísticas do banco"""
    cursor = conn.cursor()
    
    print_section("📊 Estatísticas")
    
    # Links por status
    cursor.execute("""
        SELECT status, COUNT(*) as total
        FROM tracked_links
        GROUP BY status
    """)
    links_by_status = cursor.fetchall()
    
    if links_by_status:
        print("\n  Links por Status:")
        for status, count in links_by_status:
            print(f"    {status}: {count}")
    else:
        print("\n  📭 Nenhum link rastreado ainda")
    
    # Total de mensagens processadas
    cursor.execute("SELECT COUNT(*) FROM processed_messages")
    msg_count = cursor.fetchone()[0]
    print(f"\n  📨 Mensagens processadas: {msg_count}")
    
    # Grupos configurados
    cursor.execute("""
        SELECT purpose, COUNT(*) as total
        FROM chat_preferences
        GROUP BY purpose
    """)
    groups = cursor.fetchall()
    
    if groups:
        print("\n  👥 Grupos Configurados:")
        for purpose, count in groups:
            print(f"    {purpose}: {count}")
    else:
        print("\n  ⚠️  Nenhum grupo configurado ainda")

def optimize_domains(conn):
    """Remove redundâncias de domínios"""
    cursor = conn.cursor()
    
    print_section("🔧 Otimização de Domínios")
    
    # Detecta redundâncias
    cursor.execute("""
        SELECT domain, is_active 
        FROM affiliate_domains 
        WHERE domain LIKE '%.%.%.%'
        AND is_active = 1
    """)
    
    redundant = cursor.fetchall()
    
    if redundant:
        print("\n  ⚠️  Domínios potencialmente redundantes detectados:")
        for domain, _ in redundant:
            print(f"    - {domain}")
        
        response = input("\n  Desativar domínios redundantes? (s/N): ").strip().lower()
        if response == 's':
            for domain, _ in redundant:
                cursor.execute(
                    "UPDATE affiliate_domains SET is_active = 0 WHERE domain = ?",
                    (domain,)
                )
            conn.commit()
            print("  ✅ Domínios redundantes desativados")
        else:
            print("  ℹ️  Mantendo configuração atual")
    else:
        print("  ✅ Nenhuma redundância detectada")

def main():
    """Função principal"""
    print_header("🔧 CONFIGURAÇÃO DO BANCO DE DADOS")
    print(f"Executado em: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    
    # Detecta caminho do banco
    possible_paths = [
        '../database/affiliate.db',
        './database/affiliate.db',
        'affiliate.db',
        '../affiliate.db'
    ]
    
    db_path = None
    for path in possible_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print("\n❌ Banco de dados não encontrado!")
        print("\nCaminhos testados:")
        for path in possible_paths:
            print(f"  - {path}")
        print("\nCrie o banco ou ajuste o caminho.")
        return 1
    
    print(f"\n✅ Banco encontrado: {db_path}")
    
    try:
        # Conecta ao banco
        conn = sqlite3.connect(db_path)
        print("✅ Conexão estabelecida")
        
        # Cria tabelas
        if not create_tables(conn):
            print("\n❌ Falha ao criar tabelas")
            return 1
        
        # Cria índices
        create_indexes(conn)
        
        # Testa operações
        if not test_table_operations(conn):
            print("\n❌ Falha nos testes de operação")
            return 1
        
        # Verifica domínios
        has_domains = check_affiliate_domains(conn)
        
        # Otimiza domínios
        if has_domains:
            optimize_domains(conn)
        
        # Mostra estatísticas
        show_statistics(conn)
        
        # Fecha conexão
        conn.close()
        
        # Resumo final
        print_header("✅ CONFIGURAÇÃO CONCLUÍDA COM SUCESSO!")
        
        if not has_domains:
            print("\n⚠️  ATENÇÃO: Configure domínios afiliados antes de executar o bot!")
            print("\nExecute no SQLite:")
            print("  INSERT INTO affiliate_domains (domain, affiliate_code, is_active)")
            print("  VALUES ('mercadolivre.com.br', 'SEU_CODIGO', 1);")
        else:
            print("\n🎉 Banco de dados pronto para uso!")
            print("\nPróximos passos:")
            print("  1. Substitua _message_monitor.py pela versão corrigida")
            print("  2. Execute: python3 bot_monitor.py")
            print("  3. Monitore os logs")
        
        print("\n" + "="*70 + "\n")
        return 0
        
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())