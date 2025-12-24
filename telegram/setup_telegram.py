# setup_telegram.py
import asyncio
import sys
import os
import traceback
from telegram_manager import TelegramManager

async def setup_telegram():
    print("="*50)
    print("CONFIGURAÇÃO DO SISTEMA TELEGRAM")
    print("="*50 + "\n")
    
    # Verifica se o .env existe
    if not os.path.exists('.env'):
        print("📝 Arquivo .env não encontrado. Vamos criá-lo...\n")
        
        print("🔑 PRIMEIRO: Obtenha suas credenciais em https://my.telegram.org")
        print("   - Faça login com seu número do Telegram")
        print("   - Vá em 'API Development Tools'")
        print("   - Crie um novo app\n")
        
        api_id = input("Digite seu api_id: ").strip()
        api_hash = input("Digite seu api_hash: ").strip()
        
        print("\n🤖 AGORA: Crie um bot com @BotFather no Telegram")
        print("   - Abra o Telegram, busque por @BotFather")
        print("   - Envie /newbot e siga as instruções")
        print("   - Copie o token fornecido\n")
        
        bot_token = input("Digite o token do bot: ").strip()
        
        # Cria o arquivo .env
        with open('.env', 'w') as f:
            f.write(f"TELEGRAM_API_ID={api_id}\n")
            f.write(f"TELEGRAM_API_HASH={api_hash}\n")
            f.write(f"TELEGRAM_BOT_TOKEN={bot_token}\n")
        
        print("\n✅ Arquivo .env criado com sucesso!\n")
    
    # Inicializa o manager
    manager = TelegramManager()
    
    print("🔄 Iniciando conexão com o Telegram...\n")
    
    try:
        success = await manager.initialize()
        
        if not success:
            print("❌ Falha na inicialização")
            return
        
        print("\n" + "="*50)
        print("✅ CONEXÕES ESTABELECIDAS COM SUCESSO!")
        print("="*50 + "\n")
        
        # Menu interativo
        while True:
            print("\n" + "="*40)
            print("📱 MENU DE CONFIGURAÇÃO")
            print("="*40)
            print("1. 📋 Listar meus grupos/canais")
            print("2. 🤖 Adicionar bot aos meus grupos")
            print("3. 🔧 Testar envio de mensagem como bot")
            print("4. 👤 Testar envio de mensagem como usuário")
            print("5. 💾 Salvar grupos no banco de dados")
            print("6. 🚪 Sair")
            print("="*40)
            
            choice = input("\n🎯 Escolha uma opção: ").strip()
            
            if choice == '1':
                print("\n📊 Carregando seus grupos/canais...")
                groups = await manager.get_user_groups()
                
                if not groups:
                    print("📭 Nenhum grupo encontrado.")
                else:
                    print(f"\n✅ Encontrados {len(groups)} grupos/canais:\n")
                    for i, group in enumerate(groups, 1):
                        admin_icon = "👑" if group.get('admin_permissions') else "👤"
                        type_icon = "📢" if group['is_channel'] else "👥"
                        print(f"{i}. {type_icon} {group['name']} {admin_icon}")
                        print(f"   🆔 ID: {group['id']}")
                        if group['username']:
                            print(f"   📎 @{group['username']}")
                        print(f"   👥 Membros: {group['participants_count']}")
                        print()
            
            elif choice == '2':
                print("\n🤖 Adicionando bot aos seus grupos...")
                print("⚠️  Esta operação pode levar alguns minutos...\n")
                
                added = await manager.add_bot_to_groups()
                
                if added:
                    print(f"\n✅ Sucesso! Bot adicionado a {len(added)} grupos:\n")
                    for group in added:
                        print(f"   • {group['name']}")
                    
                    # Pergunta se quer salvar no banco
                    save = input("\n💾 Deseja salvar estes grupos no banco? (s/n): ").strip().lower()
                    if save == 's':
                        await save_groups_to_db(added)
                else:
                    print("\n📭 Nenhum grupo foi adicionado.")
            
            elif choice == '3':
                print("\n🧪 TESTE DE ENVIO COMO BOT")
                print("Envie uma mensagem para 'me' para testar no seu privado")
                print("Ou use um ID/username de grupo")
                
                entity = input("\n🏷️  Digite o ID/@username ou 'me' para seu privado: ").strip()
                message = input("💬 Digite a mensagem de teste: ").strip()
                
                try:
                    if entity.lower() == 'me':
                        entity = 'me'
                    
                    await manager.send_message_as_bot(entity, message)
                    print(f"\n✅ Mensagem enviada com sucesso para {entity}!")
                except Exception as e:
                    print(f"\n❌ Erro ao enviar: {e}")
            
            elif choice == '4':
                print("\n🧪 TESTE DE ENVIO COMO USUÁRIO")
                entity = input("\n🏷️  Digite o ID/@username ou 'me' para seu privado: ").strip()
                message = input("💬 Digite a mensagem de teste: ").strip()
                
                try:
                    if entity.lower() == 'me':
                        entity = 'me'
                    
                    await manager.send_message_as_user(entity, message)
                    print(f"\n✅ Mensagem enviada com sucesso para {entity}!")
                except Exception as e:
                    print(f"\n❌ Erro ao enviar: {e}")
            
            elif choice == '5':
                print("\n💾 SALVAR GRUPOS NO BANCO")
                groups = await manager.get_user_groups()
                
                if groups:
                    admin_groups = [g for g in groups if g.get('admin_permissions')]
                    
                    if admin_groups:
                        print(f"\n👑 Grupos onde você é admin ({len(admin_groups)}):\n")
                        for i, group in enumerate(admin_groups, 1):
                            print(f"{i}. {group['name']}")
                        
                        save_all = input("\n💾 Salvar todos os grupos? (s/n): ").strip().lower()
                        
                        if save_all == 's':
                            await save_groups_to_db(admin_groups)
                        else:
                            print("Selecione os números dos grupos (ex: 1,3,5):")
                            selection = input("Números: ").strip()
                            
                            try:
                                indices = [int(x.strip()) - 1 for x in selection.split(',')]
                                selected = [admin_groups[i] for i in indices if 0 <= i < len(admin_groups)]
                                
                                if selected:
                                    await save_groups_to_db(selected)
                                else:
                                    print("❌ Nenhum grupo selecionado")
                            except:
                                print("❌ Seleção inválida")
                    else:
                        print("❌ Você não é admin em nenhum grupo")
                else:
                    print("❌ Nenhum grupo encontrado")
            
            elif choice == '6':
                print("\n👋 Saindo...")
                break
            
            else:
                print("❌ Opção inválida!")
    
    except KeyboardInterrupt:
        print("\n\n⚠️  Configuração interrompida pelo usuário.")
    except Exception as e:
        print(f"\n❌ Erro durante a configuração: {e}")
        traceback.print_exc()
    finally:
        try:
            await manager.disconnect()
        except:
            pass

async def save_groups_to_db(groups):
    """Salva grupos no banco de dados"""
    try:
        import sqlite3
        
        conn = sqlite3.connect('affiliate.db')
        cursor = conn.cursor()
        
        # Cria tabela se não existir
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS telegram_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_name TEXT NOT NULL,
                group_id TEXT NOT NULL UNIQUE,
                username TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        saved_count = 0
        for group in groups:
            try:
                cursor.execute('''
                    INSERT OR IGNORE INTO telegram_groups (group_name, group_id, username)
                    VALUES (?, ?, ?)
                ''', (group['name'], str(group['id']), group.get('username')))
                
                if cursor.rowcount > 0:
                    saved_count += 1
                    print(f"   ✅ {group['name']} salvo")
                else:
                    print(f"   ⚠️  {group['name']} já existe")
                    
            except Exception as e:
                print(f"   ❌ Erro ao salvar {group['name']}: {e}")
        
        conn.commit()
        conn.close()
        
        print(f"\n💾 Total de grupos salvos: {saved_count}")
        
    except Exception as e:
        print(f"❌ Erro ao salvar no banco: {e}")

if __name__ == "__main__":
    # Configura o loop de eventos para Windows
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    try:
        asyncio.run(setup_telegram())
    except KeyboardInterrupt:
        print("\n\n👋 Programa encerrado pelo usuário")
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        traceback.print_exc()
        input("\nPressione Enter para sair...")