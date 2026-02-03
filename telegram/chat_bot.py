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
            try:
                if isinstance(chat_id, str) and (chat_id.startswith('-') or chat_id.isdigit()):
                    chat_id = int(chat_id)
            except ValueError:
                pass # Se não for conversível (ex: @username), mantemos como string
            # --------------------------------------------
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
        """Registra envio de mensagem no banco de dados"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            sender = 'BOT' if as_bot else 'USER'
            status = 'SUCCESS' if success else 'FAILED'
            error_msg = error if error else ''
            
            # Trunca mensagem muito longa
            msg_preview = message[:100] + '...' if len(message) > 100 else message
            
            cursor.execute('''
                INSERT INTO message_logs (timestamp, sender, chat_id, status, message_preview, error)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (timestamp, sender, str(chat_id), status, msg_preview, error_msg))
            
            conn.commit()
            conn.close()
                
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
            delay: Tempo de espera entre envios (segundos)
        """
        print(f"\n📨 Enviando para {len(chat_ids)} chats...")
        
        success_count = 0
        failed_count = 0
        
        for i, chat_id in enumerate(chat_ids, 1):
            print(f"\n[{i}/{len(chat_ids)}] Processando {chat_id}...")
            
            success = await self.send_message(chat_id, message, as_bot)
            
            if success:
                success_count += 1
            else:
                failed_count += 1
            
            # Aguarda entre envios (exceto no último)
            if i < len(chat_ids):
                print(f"⏳ Aguardando {delay}s...")
                await asyncio.sleep(delay)
        
        # Resumo
        print(f"\n{'='*50}")
        print(f"✅ Sucesso: {success_count}")
        print(f"❌ Falhas: {failed_count}")
        print(f"{'='*50}")
    
    async def interactive_mode(self):
        """Modo interativo do bot"""
        if not await self.initialize():
            return
        
        while True:
            try:
                print("\n" + "="*50)
                print("🎛️  MENU PRINCIPAL")
                print("="*50)
                print("1. 📋 Listar chats")
                print("2. 📤 Enviar mensagem")
                print("3. 📨 Envio em massa")
                print("4. 💬 Modo conversa")
                print("5. 🗑️  Limpar histórico")
                print("6. 📊 Estatísticas")
                print("0. 🚪 Sair")
                
                choice = input("\nEscolha uma opção: ").strip()
                
                if choice == '0':
                    print("\n👋 Até logo!")
                    break
                elif choice == '1':
                    await self._menu_list_chats()
                elif choice == '2':
                    await self._menu_send_message()
                elif choice == '3':
                    await self._menu_bulk_send()
                elif choice == '4':
                    await self._menu_conversation()
                elif choice == '5':
                    await self._menu_clear_history()
                elif choice == '6':
                    await self._menu_stats()
                else:
                    print("❌ Opção inválida")
                    
            except KeyboardInterrupt:
                print("\n\n👋 Saindo...")
                break
            except Exception as e:
                print(f"❌ Erro: {e}")
                import traceback
                traceback.print_exc()
    
    async def _menu_list_chats(self):
        """Menu para listar chats"""
        print("\n📋 LISTAR CHATS")
        print("1. Todos os chats")
        print("2. Apenas usuários")
        print("3. Grupos e canais")
        print("4. Grupos salvos no banco")
        
        choice = input("\nEscolha: ").strip()
        
        if choice == '1':
            chats = await self.list_all_chats()
        elif choice == '2':
            chats = await self.list_users()
        elif choice == '3':
            chats = await self.list_groups()
        elif choice == '4':
            chats = await self.list_groups_from_db()
        else:
            print("❌ Opção inválida")
            return
        
        if not chats:
            print("\n📭 Nenhum chat encontrado")
            return
        
        # Exibe chats
        print(f"\n{'='*80}")
        print(f"Total: {len(chats)} chats")
        print(f"{'='*80}")
        
        for i, chat in enumerate(chats, 1):
            icon = chat.get('icon', '💬')
            name = chat['name']
            chat_id = chat['id']
            
            # Informações adicionais
            extras = []
            if 'username' in chat and chat['username']:
                extras.append(f"@{chat['username']}")
            if 'participants_count' in chat and chat['participants_count'] > 1:
                extras.append(f"{chat['participants_count']} membros")
            if 'bot_has_access' in chat and not chat['bot_has_access']:
                extras.append("⚠️ Bot sem acesso")
            
            extras_str = f" ({', '.join(extras)})" if extras else ""
            
            print(f"{i:3d}. {icon} {name}")
            print(f"     ID: {chat_id}{extras_str}")
    
    async def _menu_send_message(self):
        """Menu para enviar mensagem única"""
        print("\n📤 ENVIAR MENSAGEM")
        
        # Escolhe destinatário
        chat_id = input("ID ou @username do destinatário: ").strip()
        if not chat_id:
            print("❌ ID inválido")
            return
        
        # Escolhe remetente
        print("\nEnviar como:")
        print("1. Bot (padrão)")
        print("2. Usuário")
        sender_choice = input("Escolha (Enter = Bot): ").strip()
        as_bot = sender_choice != '2'
        
        # Mensagem
        print("\nDigite a mensagem (Enter vazio para cancelar):")
        print("(Suporta Markdown: **negrito**, *itálico*, [link](url))")
        message = input("> ").strip()
        
        if not message:
            print("❌ Mensagem vazia, cancelando...")
            return
        
        # Envia
        await self.send_message(chat_id, message, as_bot)
    
    async def _menu_bulk_send(self):
        """Menu para envio em massa"""
        print("\n📨 ENVIO EM MASSA")
        
        # Opções de seleção
        print("\n1. Digitar IDs manualmente")
        print("2. Usar grupos do banco de dados")
        
        choice = input("\nEscolha: ").strip()
        
        if choice == '1':
            ids_input = input("\nIDs (separados por vírgula): ").strip()
            chat_ids = [id.strip() for id in ids_input.split(',') if id.strip()]
        elif choice == '2':
            groups = await self.list_groups_from_db()
            if not groups:
                print("❌ Nenhum grupo no banco")
                return
            
            print(f"\nEncontr ados {len(groups)} grupos:")
            for i, g in enumerate(groups, 1):
                print(f"{i}. {g['name']} ({g['id']})")
            
            print("\nEnviar para:")
            print("1. Todos")
            print("2. Selecionar específicos")
            
            sub_choice = input("\nEscolha: ").strip()
            
            if sub_choice == '1':
                chat_ids = [str(g['id']) for g in groups]
            else:
                indices_input = input("Números (separados por vírgula): ").strip()
                try:
                    indices = [int(i.strip())-1 for i in indices_input.split(',')]
                    chat_ids = [str(groups[i]['id']) for i in indices if 0 <= i < len(groups)]
                except:
                    print("❌ Entrada inválida")
                    return
        else:
            print("❌ Opção inválida")
            return
        
        if not chat_ids:
            print("❌ Nenhum chat selecionado")
            return
        
        # Mensagem
        print(f"\nMensagem para {len(chat_ids)} chats:")
        message = input("> ").strip()
        
        if not message:
            print("❌ Mensagem vazia")
            return
        
        # Delay
        try:
            delay = float(input("\nDelay entre envios (segundos, padrão=2): ").strip() or "2")
        except:
            delay = 2.0
        
        # Confirma
        print(f"\n⚠️  Confirma envio para {len(chat_ids)} chats com delay de {delay}s?")
        confirm = input("Digite 'sim' para confirmar: ").strip().lower()
        
        if confirm != 'sim':
            print("❌ Cancelado")
            return
        
        # Envia
        await self.send_bulk_messages(chat_ids, message, delay=delay)
    
    async def _menu_conversation(self):
        """Modo conversa contínua com um chat"""
        print("\n💬 MODO CONVERSA")
        
        chat_id = input("ID ou @username: ").strip()
        if not chat_id:
            print("❌ ID inválido")
            return
        
        print("\nEnviar como:")
        print("1. Bot (padrão)")
        print("2. Usuário")
        sender_choice = input("Escolha (Enter = Bot): ").strip()
        as_bot = sender_choice != '2'
        
        print("\n" + "="*50)
        print(f"💬 Conversando com {chat_id}")
        print("Digite 'sair' para voltar ao menu")
        print("="*50 + "\n")
        
        while True:
            try:
                message = input("Você: ").strip()
                
                if message.lower() == 'sair':
                    break
                
                if message:
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
        
        # Conta mensagens no banco de dados
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Total de mensagens
            cursor.execute("SELECT COUNT(*) FROM message_logs")
            total_messages = cursor.fetchone()[0]
            
            if total_messages > 0:
                # Mensagens por tipo de remetente
                cursor.execute("SELECT COUNT(*) FROM message_logs WHERE sender = 'BOT'")
                bot_messages = cursor.fetchone()[0]
                user_messages = total_messages - bot_messages
                
                # Mensagens bem-sucedidas vs falhas
                cursor.execute("SELECT COUNT(*) FROM message_logs WHERE status = 'SUCCESS'")
                success_messages = cursor.fetchone()[0]
                failed_messages = total_messages - success_messages
                
                print(f"📨 Total de mensagens enviadas: {total_messages}")
                print(f"   🤖 Como bot: {bot_messages}")
                print(f"   👤 Como usuário: {user_messages}")
                print(f"   ✅ Sucesso: {success_messages}")
                print(f"   ❌ Falhas: {failed_messages}")
            else:
                print("📭 Nenhuma mensagem registrada")
            
            # Estatísticas de grupos e links
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


    async def send_photo(self, chat_id, photo_url, caption=None, parse_mode=None, as_bot=True):
        """Envia foto usando o TelegramManager"""
        try:
            if not hasattr(self, 'telegram'):
                print("❌ Atributo 'telegram' não encontrado")
                return False
            
            # Usa o cliente do TelegramManager
            # Provavelmente tem user_client e bot_client lá dentro
            client = None
            
            if as_bot:
                if hasattr(self.telegram, 'bot_client'):
                    client = self.telegram.bot_client
                elif hasattr(self.telegram, 'bot'):
                    client = self.telegram.bot
            else:
                if hasattr(self.telegram, 'user_client'):
                    client = self.telegram.user_client
                elif hasattr(self.telegram, 'user'):
                    client = self.telegram.user
            
            if not client:
                print("❌ Cliente não encontrado no TelegramManager")
                # Tenta descobrir atributos disponíveis
                print("   Atributos do telegram:", [a for a in dir(self.telegram) if not a.startswith('_')])
                return False
            
            print(f"📸 Enviando foto via {type(client).__name__}")
            print(f"   URL: {photo_url[:80]}...")
            
            # Método 1: Tenta URL direto (mais eficiente)
            try:
                result = await client.send_file(
                    entity=int(chat_id),
                    file=photo_url,
                    caption=caption if caption else None,
                    parse_mode=parse_mode,
                    supports_streaming=True
                )
                print("✅ Foto enviada via URL")
                self._log_message(chat_id, caption or 'Photo', as_bot, True)
                return True
            except Exception as url_error:
                print(f"⚠️  URL falhou, baixando...: {url_error}")
            
            # Método 2: Baixa e envia
            import aiohttp
            from io import BytesIO
            
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(photo_url) as resp:
                        if resp.status != 200:
                            print(f"❌ Falha ao baixar: HTTP {resp.status}")
                            self._log_message(chat_id, caption or 'Photo', as_bot, False, f'HTTP {resp.status}')
                            return False
                        
                        image_data = await resp.read()
                        print(f"✅ Baixado {len(image_data)} bytes")
                        
                        result = await client.send_file(
                            entity=int(chat_id),
                            file=BytesIO(image_data),
                            caption=caption[:1024] if caption else None,
                            parse_mode=parse_mode
                        )
                        
                        print(f"📤 Foto enviada: {'✅' if result else '❌'}")
                        
                        self._log_message(chat_id, caption or 'Photo', as_bot, result is not None)
                        
                        return result is not None
                        
            except Exception as download_error:
                print(f"❌ Erro no download: {download_error}")
                self._log_message(chat_id, caption or 'Photo', as_bot, False, str(download_error))
                return False
                
        except Exception as e:
            print(f"❌ Erro geral: {e}")
            import traceback
            traceback.print_exc()
            self._log_message(chat_id, caption or 'Photo', as_bot, False, str(e))
            return False

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
    # Executa o bot
    asyncio.run(main())