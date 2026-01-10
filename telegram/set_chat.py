#!/usr/bin/env python3
import sqlite3
import sys
import os
import asyncio

# Adiciona o diretório atual ao path para importar módulos locais
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from chat_bot import ChatBot

# Caminho do banco de dados - Ajustado para o seu ambiente
DB_PATH = '../database/affiliate.db'

async def get_all_chats():
    """Usa a lógica do ChatBot para listar grupos e canais."""
    bot = ChatBot()
    # Inicializa apenas o cliente de usuário para listar os chats
    success = await bot.telegram.initialize_user_client()
    if not success:
        print("❌ Falha ao conectar ao Telegram.")
        return []
    
    # Usa o método existente no seu ChatBot para listar chats
    # Este método já identifica se é grupo, canal e se o bot tem acesso
    chats = await bot.list_all_chats(limit=100)
    
    # Filtra apenas para grupos e canais (remove chats privados)
    filtered_chats = [c for c in chats if c['is_group'] or c['is_channel']]
    
    await bot.telegram.disconnect()
    return filtered_chats

def save_preference(chat_id, name, purpose):
    """Salva a escolha no banco de dados."""
    # Garante que a pasta do banco existe
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    try:
        if purpose == 'remover':
            conn.execute("DELETE FROM chat_preferences WHERE chat_id = ?", (str(chat_id),))
            print(f"\n✅ Preferência removida para: {name}")
        else:
            conn.execute("""
                INSERT OR REPLACE INTO chat_preferences (chat_id, purpose, updated_at) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (str(chat_id), purpose))
            print(f"\n✅ {name} configurado como {purpose.upper()}!")
        conn.commit()
    except Exception as e:
        print(f"❌ Erro ao salvar no banco: {e}")
    finally:
        conn.close()

async def interactive_menu():
    print("\n" + "="*55)
    print("🛠️  CONFIGURADOR DE CHATS (DESTINO vs RASTREIO)")
    print("="*55)
    print("🔍 Carregando seus grupos e canais...")
    
    chats = await get_all_chats()
    
    if not chats:
        print("❌ Nenhum grupo ou canal encontrado.")
        return

    while True:
        print("\n📋 CHATS ENCONTRADOS:")
        print(f"{'Nº':<4} | {'TIPO':<10} | {'NOME':<30} | {'BOT ACESSO'}")
        print("-" * 65)
        
        for i, chat in enumerate(chats, 1):
            tipo = chat['type'].upper()
            acesso = "✅ SIM" if chat.get('bot_has_access') else "❌ NÃO"
            print(f"{i:<4} | {tipo:<10} | {chat['name'][:30]:<30} | {acesso}")
        
        print("-" * 65)
        print("0. Sair")
        
        try:
            escolha = input("\nEscolha o NÚMERO do chat (ou 0 para sair): ").strip()
            if escolha == '0': break
            
            idx = int(escolha) - 1
            if idx < 0 or idx >= len(chats):
                print("❌ Número fora da lista.")
                continue
                
            chat_sel = chats[idx]
            
            print(f"\n--- CONFIGURANDO: {chat_sel['name']} ---")
            print("1. 📤 Definir como DESTINO (Onde o bot POSTA)")
            print("2. 👁️  Definir como RASTREIO (Onde o bot BUSCA)")
            print("3. 🗑️  Remover preferência (Usar lógica automática)")
            print("4. Cancelar")
            
            sub_op = input("\nEscolha a opção (1-4): ").strip()
            
            if sub_op == '1':
                save_preference(chat_sel['id'], chat_sel['name'], 'destino')
            elif sub_op == '2':
                save_preference(chat_sel['id'], chat_sel['name'], 'rastreio')
            elif sub_op == '3':
                save_preference(chat_sel['id'], chat_sel['name'], 'remover')
                
        except ValueError:
            print("❌ Por favor, digite apenas números.")
        except Exception as e:
            print(f"❌ Erro inesperado: {e}")

if __name__ == "__main__":
    # Garante a criação da tabela antes de começar
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_preferences (
            chat_id TEXT PRIMARY KEY, 
            purpose TEXT, 
            updated_at TIMESTAMP
        )
    """)
    conn.close()
    
    asyncio.run(interactive_menu())
