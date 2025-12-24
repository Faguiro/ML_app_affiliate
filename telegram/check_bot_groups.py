# telegram_bot_helper.py
import asyncio
import json
import sys
import os
# from telethon.tl.types import PeerChannel, PeerChat
from telegram_manager import TelegramManager

async def discover_bot_groups():
    """
    Descobre grupos onde o bot está usando o método CORRETO da documentação:
    "Once the library has 'seen' the entity, you can use their integer ID."
    """
    
    print("🔍 Descobrindo grupos do bot (método correto)")
    print("="*60)
    
    manager = TelegramManager()
    
    if not await manager.initialize():
        print("❌ Falha ao conectar")
        return
    
    print(f"✅ Conexões estabelecidas")
    print(f"🤖 Bot: @{manager.bot_me.username}")
    print(f"👤 Usuário: @{(await manager.user_client.get_me()).username}")
    
    try:
        # PASSO 1: Fazer o bot "ver" os grupos
        print("\n📋 PASSO 1: Fazendo o bot 'ver' os grupos...")
        
        # Método 1: Buscar mensagens que o bot recebeu
        print("🔍 Buscando mensagens recebidas pelo bot...")
        bot_groups_from_messages = await _get_groups_from_bot_messages(manager)
        
        # Método 2: Usar a conta do usuário para encontrar grupos compartilhados
        print("🔍 Buscando grupos compartilhados entre usuário e bot...")
        shared_groups = await _find_shared_groups(manager)
        
        # Combina resultados
        all_groups = {}
        
        for group in bot_groups_from_messages + shared_groups:
            if group['id'] not in all_groups:
                all_groups[group['id']] = group
            else:
                # Atualiza com informações mais completas
                existing = all_groups[group['id']]
                for key in ['is_admin', 'can_send', 'title']:
                    if key in group and group[key]:
                        existing[key] = group[key]
        
        groups_list = list(all_groups.values())
        
        if not groups_list:
            print("\n❌ Nenhum grupo foi encontrado para o bot")
            print("\n💡 SOLUÇÃO: O bot precisa 'ver' os grupos primeiro.")
            print("   1. Alguém precisa enviar uma mensagem no grupo")
            print("   2. O bot precisa estar como membro do grupo")
            print("   3. Execute 'setup_telegram.py' -> 'Adicionar bot aos meus grupos'")
            return []
        
        # PASSO 2: Verificar permissões
        print(f"\n📋 PASSO 2: Verificando permissões em {len(groups_list)} grupos...")
        
        verified_groups = []
        for group in groups_list:
            print(f"\n🔍 Verificando: {group.get('title', f'ID: {group['id']}')}")
            
            # Tenta obter a entidade completa
            try:
                entity = await manager.bot_client.get_entity(group['id'])
                group['title'] = getattr(entity, 'title', f'ID: {group["id"]}')
                group['username'] = getattr(entity, 'username', None)
                group['type'] = _get_entity_type(entity)
                
                print(f"   ✅ Entidade obtida: {group['title']}")
                
            except Exception as e:
                print(f"   ⚠️  Não conseguiu entidade completa: {e}")
                continue
            
            # Verifica permissões
            try:
                participant = await manager.bot_client.get_permissions(entity, manager.bot_me.id)
                
                if hasattr(participant, 'admin_rights') and participant.admin_rights:
                    group['is_admin'] = True
                    group['can_send'] = True
                    print(f"   👑 Bot é ADMIN")
                else:
                    group['is_admin'] = False
                    # Para usuários normais, geralmente podem enviar
                    group['can_send'] = True
                    print(f"   👤 Bot é membro")
                    
            except Exception as e:
                print(f"   ⚠️  Não conseguiu verificar permissões: {e}")
                group['can_send'] = False
            
            verified_groups.append(group)
        
        # Resultados finais
        print("\n" + "="*60)
        print("🎯 RESULTADOS FINAIS")
        print("="*60)
        
        if verified_groups:
            _save_and_show_results(verified_groups, manager.bot_me)
        else:
            print("❌ Nenhum grupo verificável encontrado")
        
        return verified_groups
        
    except Exception as e:
        print(f"❌ Erro: {e}")
        import traceback
        traceback.print_exc()
        return []
    
    finally:
        await manager.disconnect()
        print("\n🔌 Conexões encerradas")

async def _get_groups_from_bot_messages(manager):
    """Busca grupos através das mensagens que o bot recebeu"""
    groups = []
    
    try:
        # Busca as últimas mensagens do bot
        async for message in manager.bot_client.iter_messages(None, limit=50):
            if message.chat:
                chat_id = message.chat.id
                
                # Ignora mensagens privadas
                if chat_id > 0:
                    continue
                
                # Verifica se já temos este grupo
                if any(g['id'] == chat_id for g in groups):
                    continue
                
                groups.append({
                    'id': chat_id,
                    'title': getattr(message.chat, 'title', f'ID: {chat_id}'),
                    'source': 'bot_messages',
                    'last_message': message.date if hasattr(message, 'date') else None
                })
                
                print(f"   📨 Mensagem encontrada em: {groups[-1]['title']}")
    
    except Exception as e:
        print(f"⚠️  Erro ao buscar mensagens do bot: {e}")
    
    return groups

async def _find_shared_groups(manager):
    """Encontra grupos onde ambos (usuário e bot) estão"""
    shared_groups = []
    
    try:
        # Primeiro, lista grupos do usuário
        user_groups = []
        async for dialog in manager.user_client.iter_dialogs(limit=100):
            if dialog.is_group or dialog.is_channel:
                user_groups.append({
                    'id': dialog.id,
                    'title': dialog.name,
                    'entity': dialog.entity
                })
        
        print(f"👤 Usuário está em {len(user_groups)} grupos")
        
        # Agora verifica em quais o bot também está
        for i, user_group in enumerate(user_groups):
            print(f"   [{i+1}/{len(user_groups)}] Verificando: {user_group['title']}")
            
            try:
                # Tenta acessar o grupo pelo bot
                await manager.bot_client.get_permissions(user_group['id'], manager.bot_me.id)
                
                # Se chegou aqui, o bot tem acesso
                shared_groups.append({
                    'id': user_group['id'],
                    'title': user_group['title'],
                    'source': 'shared_group',
                    'entity': user_group['entity']
                })
                
                print(f"      ✅ Bot também está aqui!")
                
            except Exception as e:
                error_msg = str(e).lower()
                if "not participant" in error_msg or "no user" in error_msg:
                    print(f"      ❌ Bot NÃO está aqui")
                else:
                    print(f"      ⚠️  Erro na verificação: {e}")
            
            # Pequena pausa para evitar flood
            await asyncio.sleep(0.3)
    
    except Exception as e:
        print(f"❌ Erro ao buscar grupos compartilhados: {e}")
    
    return shared_groups

def _get_entity_type(entity):
    """Identifica o tipo da entidade"""
    if hasattr(entity, 'broadcast') and entity.broadcast:
        return 'channel'
    elif hasattr(entity, 'megagroup') and entity.megagroup:
        return 'supergroup'
    elif hasattr(entity, 'gigagroup') and entity.gigagroup:
        return 'gigagroup'
    else:
        return 'group'

def _save_and_show_results(groups, bot_info):
    """Salva e mostra os resultados"""
    # Salva em JSON
    data = {
        'bot': {
            'id': bot_info.id,
            'username': bot_info.username,
            'first_name': bot_info.first_name
        },
        'groups_found': len(groups),
        'groups': groups
    }
    
    with open('bot_discovered_groups.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"💾 Resultados salvos em: 'bot_discovered_groups.json'")
    
    # Mostra estatísticas
    admin_groups = [g for g in groups if g.get('is_admin')]
    sendable_groups = [g for g in groups if g.get('can_send', False)]
    
    print(f"\n📊 ESTATÍSTICAS:")
    print(f"   👥 Grupos descobertos: {len(groups)}")
    print(f"   👑 Como administrador: {len(admin_groups)}")
    print(f"   ✅ Pode enviar mensagens: {len(sendable_groups)}")
    
    if sendable_groups:
        print(f"\n🎯 GRUPOS PRONTOS PARA USO:")
        for i, group in enumerate(sendable_groups, 1):
            admin = "👑 " if group.get('is_admin') else ""
            print(f"   {i:2d}. {admin}{group['title']} (ID: {group['id']})")
        
        # Gera configuração
        _generate_telegram_config(sendable_groups)

def _generate_telegram_config(groups):
    """Gera configuração para telegram_sender.py"""
    config_groups = []
    
    for group in groups:
        tags = []
        
        if group.get('is_admin'):
            tags.append("admin")
        
        if group.get('type') == 'channel':
            tags.append("canal")
        elif group.get('type') == 'supergroup':
            tags.append("supergrupo")
        else:
            tags.append("grupo")
        
        tags.append("geral")
        
        config_groups.append({
            "id": group['id'],
            "name": group['title'],
            "active": True,
            "tags": tags
        })
    
    config = {
        "groups": config_groups,
        "generated_by": "bot_discovery",
        "note": "Adicione mais tags baseadas no conteúdo do grupo"
    }
    
    os.makedirs('../config', exist_ok=True)
    with open('../config/telegram_groups_discovered.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    
    print(f"\n💾 Configuração gerada: '../config/telegram_groups_discovered.json'")
    
    # Exemplo para copiar
    print(f"\n📋 EXEMPLO para telegram_groups.json:")
    print("[")
    for group in config_groups[:3]:
        print(f'  {{"id": {group["id"]}, "name": "{group["name"]}", "active": true, "tags": {group["tags"]}}},')
    if len(config_groups) > 3:
        print(f'  // ... mais {len(config_groups) - 3} grupos')
    print("]")

async def force_bot_to_see_group(manager, group_id):
    """
    Força o bot a 'ver' um grupo específico.
    Útil quando você sabe que o bot está no grupo mas ele não 'viu' ainda.
    """
    try:
        print(f"\n🔍 Forçando bot a 'ver' o grupo {group_id}...")
        
        # Método 1: Tenta enviar uma mensagem (se for admin)
        try:
            await manager.bot_client.send_message(
                group_id,
                "🤖 Bot se apresentando...",
                silent=True
            )
            print("✅ Bot enviou mensagem no grupo")
            return True
        except:
            pass
        
        # Método 2: Tenta obter informações
        try:
            entity = await manager.bot_client.get_entity(group_id)
            print(f"✅ Bot obteve entidade: {getattr(entity, 'title', 'Unknown')}")
            return True
        except:
            pass
        
        # Método 3: Tenta listar participantes (se for admin)
        try:
            async for participant in manager.bot_client.iter_participants(group_id, limit=1):
                print(f"✅ Bot listou participantes")
                return True
        except:
            pass
        
        print("❌ Não foi possível fazer o bot 'ver' o grupo")
        print("💡 Dica: Alguém precisa enviar uma mensagem no grupo mencionando o bot")
        return False
        
    except Exception as e:
        print(f"❌ Erro: {e}")
        return False

async def main():
    """Função principal"""
    print("="*60)
    print("🤖 DESCOBERTA DE GRUPOS DO BOT")
    print("="*60)
    
    print("\nEste script usa o método CORRETO da documentação do Telethon:")
    print('"Once the library has "seen" the entity, you can use their integer ID."')
    print("\nMétodos usados:")
    print("1. 📨 Mensagens recebidas pelo bot")
    print("2. 👥 Grupos compartilhados entre usuário e bot")
    print("3. 🔍 Forçar visualização de grupos específicos")
    
    print("\nSelecione:")
    print("1. 🔍 Descobrir grupos automaticamente")
    print("2. 🎯 Forçar visualização de grupo específico")
    print("3. 🧪 Testar envio em grupo descoberto")
    
    try:
        choice = input("\n🎯 Escolha (1-3): ").strip()
        
        if choice == '1':
            await discover_bot_groups()
        elif choice == '2':
            group_id = input("\nDigite o ID do grupo (ex: -1001234567890): ").strip()
            if group_id:
                manager = TelegramManager()
                if await manager.initialize():
                    await force_bot_to_see_group(manager, int(group_id))
                    await manager.disconnect()
        elif choice == '3':
            await test_send_to_discovered()
        else:
            print("❌ Opção inválida")
            
    except KeyboardInterrupt:
        print("\n\n👋 Cancelado")
    except Exception as e:
        print(f"❌ Erro: {e}")

async def test_send_to_discovered():
    """Testa envio para grupos descobertos"""
    manager = TelegramManager()
    
    if await manager.initialize():
        try:
            # Carrega grupos descobertos
            if os.path.exists('bot_discovered_groups.json'):
                with open('bot_discovered_groups.json', 'r') as f:
                    data = json.load(f)
                    groups = data.get('groups', [])
                    
                    if groups:
                        print(f"\n🧪 Testando envio para {len(groups)} grupos...")
                        
                        for group in groups[:2]:  # Testa apenas 2
                            if group.get('can_send'):
                                print(f"\n📤 Enviando para: {group['title']}")
                                try:
                                    await manager.bot_client.send_message(
                                        group['id'],
                                        "🤖 *Teste de envio automático*\n\nEsta mensagem é um teste do sistema de automação. Tudo funcionando! ✅",
                                        parse_mode='markdown',
                                        silent=True
                                    )
                                    print(f"✅ Enviado com sucesso!")
                                except Exception as e:
                                    print(f"❌ Falha: {e}")
                            else:
                                print(f"⚠️  Não pode enviar para: {group['title']}")
                    else:
                        print("❌ Nenhum grupo descoberto. Execute primeiro a opção 1.")
            else:
                print("❌ Arquivo de grupos descobertos não encontrado")
                
        except Exception as e:
            print(f"❌ Erro no teste: {e}")
        finally:
            await manager.disconnect()

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n👋 Programa encerrado")
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("\n✨ Processo concluído!")