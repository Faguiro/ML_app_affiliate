#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de diagnóstico do Bot de Afiliados
Mostra: grupos, credenciais, classificação
"""

import asyncio
import sys
from chat_bot import ChatBot  # Import do seu bot

async def diagnose_bot():
    """Faz diagnóstico completo do bot"""
    print("=" * 60)
    print("🤖 DIAGNÓSTICO DO BOT DE AFILIADOS")
    print("=" * 60)
    
    # Inicializa bot
    bot = ChatBot()
    
    print("\n1. 🔐 CREDENCIAIS E CONEXÃO:")
    print("-" * 40)
    
    try:
        # Tenta inicializar
        if await bot.initialize():
            print("✅ Bot inicializado com sucesso")
            
            # Mostra informações do bot
            if hasattr(bot, 'telegram') and bot.telegram:
                if hasattr(bot.telegram, 'bot_me') and bot.telegram.bot_me:
                    print(f"   Nome do Bot: {bot.telegram.bot_me.first_name}")
                    print(f"   Username: @{bot.telegram.bot_me.username}")
                    print(f"   ID: {bot.telegram.bot_me.id}")
                else:
                    print("   ℹ️  Informações do bot não disponíveis")
        else:
            print("❌ Falha na inicialização do bot")
            return
    except Exception as e:
        print(f"❌ Erro na inicialização: {e}")
        return
    
    print("\n2. 📊 LISTANDO TODOS OS GRUPOS/CANAIS:")
    print("-" * 40)
    
    try:
        # Pega todos os grupos/canais
        all_chats = await bot.list_groups(include_channels=True, limit=50)
        print(f"📞 Total encontrado: {len(all_chats)} grupos/canais")
        print()
        
        if not all_chats:
            print("ℹ️  Nenhum grupo/canal encontrado")
            return
        
        # Classifica manualmente (simula lógica do sistema)
        destinations = []
        tracking = []
        
        for i, chat in enumerate(all_chats, 1):
            chat_id = str(chat.get("id", "N/A"))
            chat_name = chat.get("name", "Sem nome")
            chat_type = chat.get("type", "desconhecido")
            has_access = chat.get("bot_has_access", False)
            is_admin = chat.get("admin_permissions", False)
            
            # Classificação
            purpose = "❓ Indefinido"
            if has_access and is_admin:
                purpose = "🎯 DESTINO (bot é admin)"
                destinations.append(chat)
            elif has_access:
                purpose = "📡 RASTREIO (bot é membro)"
                tracking.append(chat)
            else:
                purpose = "🚫 SEM ACESSO"
            
            print(f"{i:2d}. {chat_name}")
            print(f"     ID: {chat_id}")
            print(f"     Tipo: {chat_type}")
            print(f"     Acesso: {'✅' if has_access else '❌'}")
            print(f"     Admin: {'✅' if is_admin else '❌'}")
            print(f"     Classificação: {purpose}")
            print()
    
    except Exception as e:
        print(f"❌ Erro ao listar grupos: {e}")
    
    print("\n3. 📈 RESUMO DA CLASSIFICAÇÃO:")
    print("-" * 40)
    print(f"🎯 Destinos (onde postar): {len(destinations)}")
    print(f"📡 Rastreio (onde monitorar): {len(tracking)}")
    
    print("\n4. 📋 DETALHES DOS DESTINOS:")
    print("-" * 40)
    if destinations:
        for i, chat in enumerate(destinations, 1):
            print(f"{i}. {chat.get('name')} (ID: {chat.get('id')})")
    else:
        print("ℹ️  Nenhum destino identificado")
    
    print("\n5. 📋 DETALHES DOS RASTREIOS:")
    print("-" * 40)
    if tracking:
        for i, chat in enumerate(tracking, 1):
            print(f"{i}. {chat.get('name')} (ID: {chat.get('id')})")
    else:
        print("ℹ️  Nenhum grupo de rastreio identificado")
    
    print("\n6. ⚙️  CONFIGURAÇÕES DO SISTEMA:")
    print("-" * 40)
    
    # Verifica configurações do bot
    bot_attrs = [
        'api_id', 'api_hash', 'session_name', 
        'bot_token', 'user_client', 'bot_client'
    ]
    
    for attr in bot_attrs:
        if hasattr(bot, attr):
            value = getattr(bot, attr)
            if value and attr in ['api_hash', 'bot_token']:
                # Esconde tokens sensíveis
                masked = str(value)[:8] + "..." if len(str(value)) > 8 else "***"
                print(f"   {attr}: {masked}")
            else:
                print(f"   {attr}: {value}")
        else:
            print(f"   {attr}: ❌ Não encontrado")
    
    print("\n" + "=" * 60)
    print("✅ DIAGNÓSTICO COMPLETO")
    print("=" * 60)
    
    # Desconecta
    await bot.disconnect()

async def test_database():
    """Testa conexão com banco de dados"""
    print("\n" + "=" * 60)
    print("🗃️  TESTE DE BANCO DE DADOS")
    print("=" * 60)
    
    import sqlite3
    import os
    
    db_path = '../database/affiliate.db'
    
    if not os.path.exists(db_path):
        print(f"❌ Banco não encontrado: {db_path}")
        return
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Lista todas as tabelas
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print(f"📊 Banco encontrado: {db_path}")
        print(f"📋 Tabelas disponíveis: {len(tables)}")
        
        for table in tables:
            table_name = table[0]
            print(f"\n   Tabela: {table_name}")
            
            # Conta registros
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                count = cursor.fetchone()[0]
                print(f"     Registros: {count}")
                
                # Mostra algumas colunas se for tabela importante
                if table_name in ['affiliate_domains', 'tracked_links']:
                    cursor.execute(f"PRAGMA table_info({table_name})")
                    columns = cursor.fetchall()
                    col_names = [col[1] for col in columns[:3]]  # Primeiras 3 colunas
                    print(f"     Colunas: {', '.join(col_names)}...")
                    
                    # Mostra alguns dados
                    cursor.execute(f"SELECT * FROM {table_name} LIMIT 2")
                    sample = cursor.fetchall()
                    if sample:
                        print(f"     Amostra: {len(sample)} registros")
            except Exception as e:
                print(f"     ❌ Erro ao ler: {e}")
        
        conn.close()
        print("\n✅ Banco de dados OK")
        
    except Exception as e:
        print(f"❌ Erro no banco: {e}")

async def main():
    """Executa todos os diagnósticos"""
    try:
        await diagnose_bot()
        await test_database()
        
        print("\n" + "=" * 60)
        print("📋 RECOMENDAÇÕES:")
        print("-" * 40)
        print("1. Verifique se os grupos de DESTINO estão corretos")
        print("2. Confirme que o bot tem acesso ADMIN nos destinos")
        print("3. No rastreio, o bot precisa pelo menos ser MEMBRO")
        print("4. Use o comando /set_destino nos grupos para forçar classificação")
        print("=" * 60)
        
    except KeyboardInterrupt:
        print("\n\n🛑 Diagnóstico interrompido")
    except Exception as e:
        print(f"\n❌ Erro no diagnóstico: {e}")

if __name__ == "__main__":
    # Config para Windows se necessário
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    asyncio.run(main())
