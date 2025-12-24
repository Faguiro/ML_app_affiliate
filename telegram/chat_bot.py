# chat_bot.py
import asyncio
import sys
import os
import sqlite3
from datetime import datetime
from typing import List, Dict, Optional
import logging

# Adiciona o diretório atual ao path para importar módulos locais
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from telegram_manager import TelegramManager
from config import Config

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('chat_bot.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class ChatBot:
    """Classe principal para gerenciar envio de mensagens via Telegram"""
    
    def __init__(self):
        self.telegram = TelegramManager()
        self.db_path = Config.DATABASE_PATH
        
    async def initialize(self):
        """Inicializa as conexões com o Telegram"""
        print("\n" + "="*50)
        print("🤖 CHAT BOT - INICIALIZANDO")
        print("="*50)
        
        success = await self.telegram.initialize()
        if not success:
            print("❌ Falha ao inicializar conexões do Telegram")
            return False
        
        print("✅ Conexões estabelecidas com sucesso!")
        return True
    
    async def list_all_chats(self, limit: int = 50):
        """Lista todos os chats (usuários e grupos)"""
        if not self.telegram.user_client:
            print("❌ Cliente de usuário não inicializado")
            return []
        
        try:
            print(f"\n📋 Listando últimos {limit} chats...")
            chats = []
            
            async for dialog in self.telegram.user_client.iter_dialogs(limit=limit):
                try:
                    chat_info = await self._get_chat_info(dialog)
                    if chat_info:
                        chats.append(chat_info)
                        
                except Exception as e:
                    logger.error(f"Erro ao processar {dialog.name}: {e}")
                    continue
            
            # Ordena por nome
            chats.sort(key=lambda x: x['name'].lower())
            return chats
            
        except Exception as e:
            logger.error(f"Erro ao listar chats: {e}")
            return []
    
    async def _get_chat_info(self, dialog) -> Dict:
        """Obtém informações detalhadas de um chat"""
        entity = dialog.entity
        
        # Identifica tipo
        if hasattr(entity, 'broadcast') and entity.broadcast:
            chat_type = 'channel'
            type_icon = '📢'
        elif hasattr(entity, 'megagroup') and entity.megagroup:
            chat_type = 'supergroup'
            type_icon = '👥'
        elif dialog.is_group:
            chat_type = 'group'
            type_icon = '👥'
        else:
            chat_type = 'user'
            type_icon = '👤'
        
        # Informações básicas
        info = {
            'id': dialog.id,
            'name': dialog.name,
            'type': chat_type,
            'icon': type_icon,
            'username': getattr(entity, 'username', None),
            'unread_count': dialog.unread_count,
            'last_message_date': dialog.date.strftime('%d/%m/%Y %H:%M') if dialog.date else None,
            'is_user': chat_type == 'user',
            'is_group': chat_type in ['group', 'supergroup'],
            'is_channel': chat_type == 'channel',
            'participants_count': getattr(entity, 'participants_count', 0) if chat_type != 'user' else 1
        }
        
        # Verifica se o bot tem acesso
        if self.telegram.bot_client:
            try:
                await self.telegram.bot_client.get_permissions(dialog.id, self.telegram.bot_me.id)
                info['bot_has_access'] = True
            except:
                info['bot_has_access'] = False
        else:
            info['bot_has_access'] = False
        
        return info
    
    async def list_users(self, limit: int = 100):
        """Lista apenas usuários"""
        all_chats = await self.list_all_chats(limit * 2)  # Busca mais para filtrar
        users = [chat for chat in all_chats if chat['is_user']]
        return users[:limit]
    
    async def list_groups(self, include_channels: bool = True, limit: int = 100):
        """Lista grupos e canais"""
        all_chats = await self.list_all_chats(limit * 2)
        
        if include_channels:
            groups = [chat for chat in all_chats if chat['is_group'] or chat['is_channel']]
        else:
            groups = [chat for chat in all_chats if chat['is_group']]
        
        return groups[:limit]
    
    async def list_groups_from_db(self):
        """Lista grupos salvos no banco de dados"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT * FROM telegram_groups 
                WHERE is_active = 1 
                ORDER BY group_name
            ''')
            
            groups = []
            for row in cursor.fetchall():
                groups.append({
                    'id': row['group_id'],
                    'name': row['group_name'],
                    'username': row['username'],
                    'db_id': row['id'],
                    'source': 'database'
                })
            
            conn.close()
            return groups
            
        except Exception as e:
            logger.error(f"Erro ao buscar grupos do banco: {e}")
            return []
    
    async def send_message(self, chat_id: str, message: str, 
                          as_bot: bool = True, 
                          parse_mode: str = 'markdown',
                          link_preview: bool = True) -> bool:
        """
        Envia mensagem para um chat
        
        Args:
            chat_id: ID ou username do chat
            message: Texto da mensagem
            as_bot: Se True, envia como bot, se False, envia como usuário
            parse_mode: 'markdown', 'html' ou None
            link_preview: Se True, mostra pré-visualização de links
            
        Returns:
            bool: True se enviado com sucesso
        """
        try:
            print(f"\n📤 Enviando mensagem para {chat_id}...")
            
            if as_bot and not self.telegram.bot_client:
                print("❌ Bot não disponível, enviando como usuário...")
                as_bot = False
            
            kwargs = {
                'parse_mode': parse_mode if parse_mode else None,
                'link_preview': link_preview
            }
            
            if as_bot:
                result = await self.telegram.send_message_as_bot(chat_id, message, **kwargs)
            else:
                result = await self.telegram.send_message_as_user(chat_id, message, **kwargs)
            
            if result:
                print(f"✅ Mensagem enviada com sucesso!")
                
                # Registra no log
                self._log_message(chat_id, message, as_bot, True)
                return True
            else:
                print(f"❌ Falha ao enviar mensagem")
                self._log_message(chat_id, message, as_bot, False)
                return False
                
        except Exception as e:
            print(f"❌ Erro ao enviar mensagem: {e}")
            self._log_message(chat_id, message, as_bot, False, str(e))
            return False
    
    def _log_message(self, chat_id: str, message: str, as_bot: bool, 
                    success: bool, error: str = None):
        """Registra envio de mensagem no log"""
        try:
            with open('message_log.csv', 'a', encoding='utf-8') as f:
                timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                sender = 'BOT' if as_bot else 'USER'
                status = 'SUCCESS' if success else 'FAILED'
                error_msg = error if error else ''
                
                # Trunca mensagem muito longa para o CSV
                msg_preview = message[:100] + '...' if len(message) > 100 else message
                msg_preview = msg_preview.replace('\n', ' ').replace(',', ';')
                
                f.write(f'{timestamp},{sender},{chat_id},{status},{msg_preview},{error_msg}\n')
                
        except Exception as e:
            logger.error(f"Erro ao registrar log: {e}")
    
    async def send_bulk_messages(self, chat_ids: List[str], message: str, 
                                as_bot: bool = True, delay: float = 2.0):
        """
        Envia mensagem para múltiplos chats
        
        Args:
            chat_ids: Lista de IDs ou usernames
            message: Texto da mensagem
            as_bot: Se True, envia como bot
            delay: Delay entre envios (em segundos)
        """
        print(f"\n📨 Enviando mensagem para {len(chat_ids)} chats...")
        print(f"⏳ Delay entre envios: {delay} segundos")
        
        successful = 0
        failed = 0
        
        for i, chat_id in enumerate(chat_ids, 1):
            print(f"\n[{i}/{len(chat_ids)}] Enviando para: {chat_id}")
            
            success = await self.send_message(chat_id, message, as_bot)
            
            if success:
                successful += 1
            else:
                failed += 1
            
            # Aguarda entre envios (exceto no último)
            if i < len(chat_ids):
                print(f"⏳ Aguardando {delay} segundos...")
                await asyncio.sleep(delay)
        
        print(f"\n{'='*50}")
        print(f"📊 RESULTADO DO ENVIO EM MASSA")
        print(f"   ✅ Sucessos: {successful}")
        print(f"   ❌ Falhas: {failed}")
        print(f"   📊 Total: {len(chat_ids)}")
        print(f"{'='*50}")
    
    async def search_chats(self, search_term: str, search_in: str = 'all'):
        """
        Busca chats por nome ou username
        
        Args:
            search_term: Termo de busca
            search_in: 'all', 'users', 'groups', 'channels'
        """
        print(f"\n🔍 Buscando por: '{search_term}'")
        
        all_chats = await self.list_all_chats(200)
        
        # Filtra por tipo se especificado
        if search_in == 'users':
            chats = [c for c in all_chats if c['is_user']]
        elif search_in == 'groups':
            chats = [c for c in all_chats if c['is_group']]
        elif search_in == 'channels':
            chats = [c for c in all_chats if c['is_channel']]
        else:
            chats = all_chats
        
        # Filtra por termo de busca
        results = []
        search_lower = search_term.lower()
        
        for chat in chats:
            if (search_lower in chat['name'].lower() or
                (chat['username'] and search_lower in chat['username'].lower())):
                results.append(chat)
        
        return results
    
    async def interactive_mode(self):
        """Modo interativo do ChatBot"""
        if not await self.initialize():
            return
        
        print("\n" + "="*50)
        print("💬 CHAT BOT - MODO INTERATIVO")
        print("="*50)
        
        while True:
            print("\n" + "="*40)
            print("📱 MENU PRINCIPAL")
            print("="*40)
            print("1. 👤 Listar usuários")
            print("2. 👥 Listar grupos/canais")
            print("3. 💾 Listar grupos do banco de dados")
            print("4. 🔍 Buscar chats")
            print("5. 📤 Enviar mensagem para um chat")
            print("6. 📨 Enviar mensagem para múltiplos chats")
            print("7. 💬 Conversar com um chat específico")
            print("8. 🗑️  Limpar histórico de um chat")
            print("9. 📊 Estatísticas")
            print("0. 🚪 Sair")
            print("="*40)
            
            try:
                choice = input("\n🎯 Escolha uma opção: ").strip()
                
                if choice == '1':
                    await self._menu_list_users()
                elif choice == '2':
                    await self._menu_list_groups()
                elif choice == '3':
                    await self._menu_list_db_groups()
                elif choice == '4':
                    await self._menu_search()
                elif choice == '5':
                    await self._menu_send_single()
                elif choice == '6':
                    await self._menu_send_bulk()
                elif choice == '7':
                    await self._menu_chat_specific()
                elif choice == '8':
                    await self._menu_clear_history()
                elif choice == '9':
                    await self._menu_stats()
                elif choice == '0':
                    print("\n👋 Saindo...")
                    break
                else:
                    print("❌ Opção inválida!")
            
            except KeyboardInterrupt:
                print("\n\n⚠️  Operação cancelada pelo usuário")
            except Exception as e:
                print(f"❌ Erro: {e}")
    
    async def _menu_list_users(self):
        """Menu para listar usuários"""
        print("\n👤 LISTANDO USUÁRIOS")
        users = await self.list_users()
        
        if not users:
            print("📭 Nenhum usuário encontrado")
            return
        
        print(f"\n📊 Total: {len(users)} usuários\n")
        
        for i, user in enumerate(users, 1):
            unread = f"📬({user['unread_count']})" if user['unread_count'] > 0 else ""
            bot_access = "🤖" if user.get('bot_has_access') else ""
            
            print(f"{i:3d}. {user['icon']} {user['name']} {unread} {bot_access}")
            if user['username']:
                print(f"     📎 @{user['username']}")
            print(f"     🆔 {user['id']}")
            if user['last_message_date']:
                print(f"     🕒 {user['last_message_date']}")
            print()
    
    async def _menu_list_groups(self, is_choice = None):
        """Menu para listar grupos"""
        
        
        if is_choice == None: 
            print("\n👥 LISTANDO GRUPOS E CANAIS")
            print("1. Grupos apenas")
            print("2. Canais apenas")
            print("3. Todos")
            sub_choice = input("\nEscolha: ").strip()
        else :
            sub_choice = is_choice
            
        if sub_choice == '1':
            include_channels = False
            label = "GRUPOS"
        elif sub_choice == '2':
            groups = await self.list_groups(include_channels=True)
            groups = [g for g in groups if g['is_channel']]
            label = "CANAIS"
        else:
            include_channels = True
            label = "GRUPOS E CANAIS"
        
        if sub_choice != '2':
            groups = await self.list_groups(include_channels)
        
        if not groups:
            print(f"📭 Nenhum {label.lower()} encontrado")
            return
        
        print(f"\n📊 Total: {len(groups)} {label.lower()}\n")
        
        for i, group in enumerate(groups, 1):
            unread = f"📬({group['unread_count']})" if group['unread_count'] > 0 else ""
            bot_access = "🤖" if group.get('bot_has_access') else "⛔"
            members = f"👥{group['participants_count']}" if group['participants_count'] > 0 else ""
            

            if is_choice == None:
                print(f"{i:3d}. {group['icon']} {group['name']} {unread} {bot_access} {members}")
                if group['username']:
                    print(f"     📎 @{group['username']}")
                print(f"     🆔 {group['id']}")
                print(f"     📋 {group['type']}")
                if group['last_message_date']:
                    print(f"     🕒 {group['last_message_date']}")
                print()
            else:
                return groups
            
    async def _menu_list_db_groups(self):
        """Menu para listar grupos do banco"""
        print("\n💾 GRUPOS DO BANCO DE DADOS")
        groups = await self.list_groups_from_db()
        
        if not groups:
            print("📭 Nenhum grupo no banco de dados")
            return
        
        print(f"\n📊 Total: {len(groups)} grupos\n")
        
        for i, group in enumerate(groups, 1):
            print(f"{i:3d}. 👥 {group['name']}")
            if group['username']:
                print(f"     📎 @{group['username']}")
            print(f"     🆔 {group['id']}")
            print(f"     🗃️  ID no BD: {group['db_id']}")
            print()
    
    async def _menu_search(self):
        """Menu de busca"""
        print("\n🔍 BUSCAR CHATS")
        search_term = input("Digite o termo de busca: ").strip()
        
        if not search_term:
            print("❌ Termo de busca vazio")
            return
        
        print("\nOnde buscar?")
        print("1. Todos os chats")
        print("2. Apenas usuários")
        print("3. Apenas grupos")
        print("4. Apenas canais")
        
        choice = input("\nEscolha: ").strip()
        
        if choice == '1':
            search_in = 'all'
        elif choice == '2':
            search_in = 'users'
        elif choice == '3':
            search_in = 'groups'
        elif choice == '4':
            search_in = 'channels'
        else:
            search_in = 'all'
        
        results = await self.search_chats(search_term, search_in)
        
        if not results:
            print(f"\n🔍 Nenhum resultado encontrado para '{search_term}'")
            return
        
        print(f"\n📊 Resultados encontrados: {len(results)}\n")
        
        for i, result in enumerate(results, 1):
            icon = result['icon']
            bot_access = "🤖" if result.get('bot_has_access') else ""
            unread = f"📬({result['unread_count']})" if result['unread_count'] > 0 else ""
            
            print(f"{i:3d}. {icon} {result['name']} {unread} {bot_access}")
            if result['username']:
                print(f"     📎 @{result['username']}")
            print(f"     🆔 {result['id']}")
            print(f"     📋 {result['type']}")
            print()
    
    async def _menu_send_single(self):
        """Menu para envio único"""
        print("\n📤 ENVIAR MENSAGEM ÚNICA")
        
        # Selecionar tipo de chat
        print("\nSelecionar chat por:")
        print("1. ID ou username")
        print("2. Listar e escolher")
        
        choice = input("\nEscolha: ").strip()
        
        chat_id = None
        if choice == '1':
            chat_id = input("\nDigite ID ou @username: ").strip()
        elif choice == '2':
            chats = await self.list_all_chats(50)
            if not chats:
                print("❌ Nenhum chat disponível")
                return
            
            print("\n📋 Chats disponíveis:")
            for i, chat in enumerate(chats[:20], 1):  # Mostra apenas 20
                print(f"{i:2d}. {chat['icon']} {chat['name']} ({chat['id']})")
            
            try:
                idx = int(input("\nEscolha o número: ")) - 1
                if 0 <= idx < len(chats):
                    chat_id = chats[idx]['id']
                else:
                    print("❌ Número inválido")
                    return
            except:
                print("❌ Entrada inválida")
                return
        
        if not chat_id:
            print("❌ Chat não especificado")
            return
        
        # Configurar mensagem
        print("\n✏️  CONFIGURAR MENSAGEM")
        print("Digite a mensagem (Ctrl+D para finalizar, Ctrl+C para cancelar):")
        print("-" * 40)
        
        try:
            lines = []
            while True:
                try:
                    line = input()
                    lines.append(line)
                except EOFError:
                    break
                except KeyboardInterrupt:
                    print("\n❌ Cancelado")
                    return
            
            message = '\n'.join(lines)
            
            if not message.strip():
                print("❌ Mensagem vazia")
                return
        
        except Exception as e:
            print(f"❌ Erro: {e}")
            return
        
        # Configurar opções
        print("\n⚙️  CONFIGURAÇÕES")
        as_bot = input("Enviar como bot? (s/n): ").strip().lower() != 'n'
        
        parse_mode = input("Modo de formatação (markdown/html/none): ").strip().lower()
        if parse_mode not in ['markdown', 'html', 'none']:
            parse_mode = 'markdown'
        if parse_mode == 'none':
            parse_mode = None
        
        link_preview = input("Mostrar pré-visualização de links? (s/n): ").strip().lower() != 'n'
        
        # Confirmar
        print(f"\n📝 RESUMO DO ENVIO:")
        print(f"   Para: {chat_id}")
        print(f"   Como: {'🤖 Bot' if as_bot else '👤 Usuário'}")
        print(f"   Tamanho: {len(message)} caracteres")
        print(f"   Preview: {'Sim' if link_preview else 'Não'}")
        
        confirm = input("\n✅ Confirmar envio? (s/n): ").strip().lower()
        if confirm != 's':
            print("❌ Envio cancelado")
            return
        
        # Enviar
        await self.send_message(chat_id, message, as_bot, parse_mode, link_preview)
    
    async def _menu_send_bulk(self):
        """Menu para envio em massa"""
        print("\n📨 ENVIO EM MASSA")
        
        # Selecionar fonte dos chats
        print("\nSelecionar chats de:")
        print("1. Lista manual (digitar IDs/usernames)")
        print("2. Grupos do banco de dados")
        print("3. Buscar e selecionar")
        
        choice = input("\nEscolha: ").strip()
        
        chat_ids = []
        
        if choice == '1':
            print("\n📝 Digite os IDs/usernames (um por linha, linha vazia para terminar):")
            while True:
                try:
                    chat_id = input().strip()
                    if not chat_id:
                        break
                    chat_ids.append(chat_id)
                except EOFError:
                    break
        
        elif choice == '2':
            groups = await self.list_groups_from_db()
            if not groups:
                print("❌ Nenhum grupo no banco de dados")
                return
            
            # Mostrar grupos
            for i, group in enumerate(groups, 1):
                print(f"{i:3d}. {group['name']} ({group['id']})")
            
            selection = input("\nSelecionar quais? (todos, ou números separados por vírgula): ").strip()
            
            if selection.lower() == 'todos':
                chat_ids = [group['id'] for group in groups]
            else:
                try:
                    indices = [int(x.strip()) - 1 for x in selection.split(',')]
                    for idx in indices:
                        if 0 <= idx < len(groups):
                            chat_ids.append(groups[idx]['id'])
                except:
                    print("❌ Seleção inválida")
                    return
        
        elif choice == '3':
            search_term = input("\n🔍 Termo de busca: ").strip()
            if not search_term:
                print("❌ Termo vazio")
                return
            
            results = await self.search_chats(search_term, 'all')
            if not results:
                print("❌ Nenhum resultado")
                return
            
            for i, result in enumerate(results, 1):
                print(f"{i:3d}. {result['icon']} {result['name']} ({result['id']})")
            
            selection = input("\nSelecionar quais? (todos, ou números separados por vírgula): ").strip()
            
            if selection.lower() == 'todos':
                chat_ids = [result['id'] for result in results]
            else:
                try:
                    indices = [int(x.strip()) - 1 for x in selection.split(',')]
                    for idx in indices:
                        if 0 <= idx < len(results):
                            chat_ids.append(results[idx]['id'])
                except:
                    print("❌ Seleção inválida")
                    return
        
        else:
            print("❌ Opção inválida")
            return
        
        if not chat_ids:
            print("❌ Nenhum chat selecionado")
            return
        
        # Configurar mensagem
        print("\n✏️  MENSAGEM PARA TODOS OS CHATS")
        print("Digite a mensagem (Ctrl+D para finalizar):")
        print("-" * 40)
        
        try:
            lines = []
            while True:
                try:
                    line = input()
                    lines.append(line)
                except EOFError:
                    break
            
            message = '\n'.join(lines)
            
            if not message.strip():
                print("❌ Mensagem vazia")
                return
        
        except Exception as e:
            print(f"❌ Erro: {e}")
            return
        
        # Configurar opções
        print("\n⚙️  CONFIGURAÇÕES")
        as_bot = input("Enviar como bot? (s/n): ").strip().lower() != 'n'
        
        try:
            delay = float(input("Delay entre envios (segundos): ").strip() or "2.0")
        except:
            delay = 2.0
        
        # Confirmar
        print(f"\n📝 RESUMO DO ENVIO EM MASSA:")
        print(f"   Número de chats: {len(chat_ids)}")
        print(f"   Como: {'🤖 Bot' if as_bot else '👤 Usuário'}")
        print(f"   Delay: {delay} segundos")
        print(f"   Tamanho da mensagem: {len(message)} caracteres")
        
        confirm = input("\n⚠️  CONFIRMAR ENVIO EM MASSA? (s/n): ").strip().lower()
        if confirm != 's':
            print("❌ Cancelado")
            return
        
        # Enviar
        await self.send_bulk_messages(chat_ids, message, as_bot, delay)
    
    async def _menu_chat_specific(self):
        """Menu para conversar com chat específico"""
        print("\n💬 CONVERSAR COM CHAT ESPECÍFICO")
        
        chat_id = input("Digite ID ou @username do chat: ").strip()
        if not chat_id:
            print("❌ Chat não especificado")
            return
        
        print(f"\n💬 Iniciando conversa com {chat_id}")
        print("Digite '!sair' para sair, '!modo usuario' ou '!modo bot' para mudar modo")
        print("-" * 50)
        
        as_bot = True
        
        while True:
            try:
                message = input(f"[{'BOT' if as_bot else 'USER'}] > ").strip()
                
                if not message:
                    continue
                
                if message.lower() == '!sair':
                    print("👋 Saindo do modo conversa...")
                    break
                
                if message.lower() == '!modo usuario':
                    as_bot = False
                    print("🔁 Modo alterado para: USUÁRIO")
                    continue
                
                if message.lower() == '!modo bot':
                    as_bot = True
                    print("🔁 Modo alterado para: BOT")
                    continue
                
                # Envia a mensagem
                success = await self.send_message(chat_id, message, as_bot)
                
                if not success:
                    print("❌ Falha ao enviar mensagem")
            
            except KeyboardInterrupt:
                print("\n👋 Saindo do modo conversa...")
                break
            except Exception as e:
                print(f"❌ Erro: {e}")
    
    async def _menu_clear_history(self):
        """Menu para limpar histórico"""
        print("\n⚠️  LIMPAR HISTÓRICO")
        print("Esta funcionalidade requer permissões especiais.")
        print("Em desenvolvimento...")
        # Implementação futura
    
    async def _menu_stats(self):
        """Menu de estatísticas"""
        print("\n📊 ESTATÍSTICAS")
        
        # Conta mensagens no log
        try:
            with open('message_log.csv', 'r', encoding='utf-8') as f:
                lines = f.readlines()
                total_messages = len(lines) - 1 if lines else 0  # -1 para cabeçalho
                
                if total_messages > 0:
                    bot_messages = sum(1 for line in lines if ',BOT,' in line)
                    user_messages = total_messages - bot_messages
                    
                    print(f"📨 Total de mensagens enviadas: {total_messages}")
                    print(f"   🤖 Como bot: {bot_messages}")
                    print(f"   👤 Como usuário: {user_messages}")
                else:
                    print("📭 Nenhuma mensagem registrada")
        except FileNotFoundError:
            print("📭 Arquivo de log não encontrado")
        
        # Conta grupos no banco
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("SELECT COUNT(*) FROM telegram_groups WHERE is_active = 1")
            db_groups = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM tracked_links")
            total_links = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM tracked_links WHERE sent_to_telegram = 1")
            sent_links = cursor.fetchone()[0]
            
            conn.close()
            
            print(f"\n🗃️  Banco de dados:")
            print(f"   👥 Grupos ativos: {db_groups}")
            print(f"   🔗 Links rastreados: {total_links}")
            print(f"   📤 Links enviados: {sent_links}")
            
        except Exception as e:
            print(f"❌ Erro ao acessar banco: {e}")
    
    async def disconnect(self):
        """Desconecta todas as conexões"""
        await self.telegram.disconnect()
        print("\n🔌 Conexões encerradas")

async def main():
    """Função principal"""
    # Configuração para Windows
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    bot = ChatBot()
    
    try:
        # Modo de operação
        print("\n🎛️  MODOS DE OPERAÇÃO:")
        print("1. Modo interativo")
        print("2. Enviar mensagem direta (com argumentos)")
        
        mode = input("\nEscolha o modo: ").strip()
        
        if mode == '2':
            # Modo com argumentos de linha de comando
            import argparse
            
            parser = argparse.ArgumentParser(description='Chat Bot para Telegram')
            parser.add_argument('--to', required=True, help='ID ou username do chat')
            parser.add_argument('--message', required=True, help='Mensagem a ser enviada')
            parser.add_argument('--as-user', action='store_true', help='Enviar como usuário (padrão: bot)')
            parser.add_argument('--delay', type=float, default=2.0, help='Delay entre envios')
            
            args = parser.parse_args()
            
            if await bot.initialize():
                await bot.send_message(args.to, args.message, not args.as_user)
                await bot.disconnect()
        
        else:
            # Modo interativo (padrão)
            await bot.interactive_mode()
    
    except KeyboardInterrupt:
        print("\n\n👋 Programa interrompido pelo usuário")
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await bot.disconnect()

if __name__ == "__main__":
    # Cria arquivo de log CSV se não existir
    if not os.path.exists('message_log.csv'):
        with open('message_log.csv', 'w', encoding='utf-8') as f:
            f.write('timestamp,sender,chat_id,status,message_preview,error\n')
    
    # Executa o bot
    asyncio.run(main())