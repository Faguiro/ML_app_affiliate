# telegram_manager.py
import asyncio
import os
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import FloodWaitError, ChatAdminRequiredError, UserNotParticipantError
from telethon.tl.functions.channels import InviteToChannelRequest, GetFullChannelRequest
from telethon.tl.functions.messages import AddChatUserRequest, GetFullChatRequest
from telethon.tl.types import Chat, Channel, User
import logging
from config import Config

logger = logging.getLogger(__name__)

class TelegramManager:
    """Gerenciador para ambas as contas: User e Bot"""
    
    def __init__(self):
        self.user_client = None
        self.bot_client = None
        self.bot_me = None
        self.session_string = None
    
    async def initialize_user_client(self):
        """Inicializa a conexão com a conta de usuário"""
        try:
            print("\n🔐 Conectando conta de usuário...")
            
            if os.path.exists('session.txt'):
                with open('session.txt', 'r') as f:
                    self.session_string = f.read().strip()
                
                self.user_client = TelegramClient(
                    StringSession(self.session_string),
                    Config.TELEGRAM_API_ID,
                    Config.TELEGRAM_API_HASH
                )
            else:
                self.user_client = TelegramClient(
                    'my_account',
                    Config.TELEGRAM_API_ID,
                    Config.TELEGRAM_API_HASH
                )
            
            await self.user_client.connect()
            
            if not await self.user_client.is_user_authorized():
                print("\n📱 Autorização necessária...")
                print("1. Digite seu número com código do país (ex: +5511999999999)")
                print("2. Insira o código recebido no Telegram")
                print("3. Digite a senha 2FA se tiver\n")
                await self.user_client.start()
            
            if not self.session_string:
                self.session_string = self.user_client.session.save()
                with open('session.txt', 'w') as f:
                    f.write(self.session_string)
            
            me = await self.user_client.get_me()
            print(f"✅ Conectado como: {me.first_name} (@{me.username})")
            
            return True
            
        except Exception as e:
            print(f"❌ Erro ao conectar conta de usuário: {e}")
            return False
    
    async def initialize_bot_client(self):
        """Inicializa a conexão com o bot"""
        try:
            print("\n🤖 Conectando bot...")
            self.bot_client = TelegramClient(
                'bot_session',
                Config.TELEGRAM_API_ID,
                Config.TELEGRAM_API_HASH
            )
            
            await self.bot_client.start(bot_token=Config.TELEGRAM_BOT_TOKEN)
            self.bot_me = await self.bot_client.get_me()
            print(f"✅ Bot conectado: @{self.bot_me.username} (ID: {self.bot_me.id})")
            
            return True
            
        except Exception as e:
            print(f"❌ Erro ao conectar bot: {e}")
            return False
    
    async def initialize(self):
        """Inicializa ambas as conexões"""
        user_success = await self.initialize_user_client()
        if not user_success:
            return False
        
        bot_success = await self.initialize_bot_client()
        return user_success and bot_success
    
    async def _get_chat_type(self, chat_id):
        """Identifica o tipo de chat (grupo, supergrupo ou canal)"""
        try:
            chat = await self.user_client.get_entity(chat_id)
            
            if hasattr(chat, 'megagroup') and chat.megagroup:
                return 'supergroup'  # Supergrupo (canal com chat)
            elif hasattr(chat, 'broadcast') and chat.broadcast:
                return 'channel'  # Canal de broadcast
            elif hasattr(chat, 'gigagroup') and chat.gigagroup:
                return 'gigagroup'  # Grupo muito grande
            else:
                return 'group'  # Grupo comum
            
        except Exception as e:
            print(f"❌ Erro ao identificar tipo do chat: {e}")
            return None
    
    async def _is_bot_in_chat(self, chat_id):
        """Verifica se o bot já está no chat"""
        try:
            await self.bot_client.get_permissions(chat_id, self.bot_me.id)
            return True
        except (ValueError, UserNotParticipantError):
            return False
        except Exception as e:
            print(f"⚠️  Erro ao verificar se bot está no chat: {e}")
            return False
    
    async def add_bot_to_groups(self):
        """Adiciona o bot a todos os grupos onde você é admin"""
        if not self.user_client or not self.bot_client:
            print("❌ Conexões não inicializadas")
            return []
        
        added_groups = []
        
        try:
            print("\n🔍 Buscando seus grupos/canais...")
            groups = await self.get_user_groups()
            
            if not groups:
                print("📭 Nenhum grupo encontrado")
                return []
            
            admin_groups = [g for g in groups if g.get('admin_permissions')]
            print(f"👑 Encontrados {len(admin_groups)} grupos onde você é admin")
            
            for group in admin_groups:
                try:
                    print(f"\n📋 Processando: {group['name']} ({group['type']})")
                    
                    # Verifica se o bot já está no grupo
                    if await self._is_bot_in_chat(group['id']):
                        print(f"   ✅ Bot já está no grupo")
                        continue
                    
                    # Adiciona o bot baseado no tipo de chat
                    success = await self._add_bot_to_chat(
                        group['id'],
                        group['type'],
                        group['name']
                    )
                    
                    if success:
                        added_groups.append({
                            'name': group['name'],
                            'id': group['id'],
                            'username': group.get('username'),
                            'type': group['type']
                        })
                        print(f"   ✅ Bot adicionado com sucesso!")
                    else:
                        print(f"   ❌ Não foi possível adicionar o bot")
                    
                    # Pausa para evitar flood
                    await asyncio.sleep(3)
                    
                except FloodWaitError as e:
                    print(f"   ⏳ Flood wait: {e.seconds} segundos")
                    await asyncio.sleep(e.seconds + 10)
                except Exception as e:
                    print(f"   ❌ Erro no grupo {group['name']}: {e}")
                    continue
            
            return added_groups
            
        except Exception as e:
            print(f"❌ Erro geral ao adicionar bot: {e}")
            return []
    
    async def _add_bot_to_chat(self, chat_id, chat_type, chat_name):
        """Adiciona bot a um chat específico baseado no tipo"""
        try:
            # Obtém a entidade completa
            chat = await self.user_client.get_entity(chat_id)
            
            if chat_type in ['channel', 'supergroup', 'gigagroup']:
                # Para canais e supergrupos
                print(f"   📢 Adicionando bot a canal/supergrupo...")
                
                # Tenta como admin primeiro
                try:
                    # Adiciona o bot como admin
                    await self.user_client(InviteToChannelRequest(
                        channel=chat,
                        users=[self.bot_me]
                    ))
                    return True
                    
                except Exception as e:
                    print(f"   ⚠️  Não foi possível adicionar como admin: {e}")
                    
                    # Tenta método alternativo para canais
                    try:
                        # Usa o método de convite direto
                        invite_link = await self.user_client.create_chat_invite(chat_id)
                        await self.bot_client.join_chat(invite_link.link)
                        return True
                    except Exception as e2:
                        print(f"   ⚠️  Método alternativo falhou: {e2}")
                        return False
            
            else:
                # Para grupos comuns
                print(f"   👥 Adicionando bot a grupo comum...")
                
                try:
                    # Adiciona usuário ao grupo
                    await self.user_client(AddChatUserRequest(
                        chat_id=chat_id,
                        user_id=self.bot_me.id,
                        fwd_limit=100  # Número de mensagens para encaminhar
                    ))
                    return True
                    
                except Exception as e:
                    print(f"   ⚠️  Erro ao adicionar: {e}")
                    
                    # Método alternativo para grupos
                    try:
                        # Cria link de convite
                        invite = await self.user_client(export_chat_invite(chat_id))
                        await self.bot_client.join_chat(invite.link)
                        return True
                    except Exception as e2:
                        print(f"   ⚠️  Método alternativo falhou: {e2}")
                        return False
                        
        except Exception as e:
            print(f"   ❌ Erro ao adicionar bot: {e}")
            return False
    
    async def get_user_groups(self):
        """Lista todos os grupos onde o usuário é membro"""
        if not self.user_client:
            return []
        
        groups = []
        try:
            print("📋 Listando seus diálogos...")
            
            async for dialog in self.user_client.iter_dialogs(limit=100):
                try:
                    # Ignora chats privados
                    if not (dialog.is_group or dialog.is_channel):
                        continue
                    
                    # Obtém informações do chat
                    chat = dialog.entity
                    
                    # Identifica o tipo
                    if hasattr(chat, 'megagroup') and chat.megagroup:
                        chat_type = 'supergroup'
                    elif hasattr(chat, 'broadcast') and chat.broadcast:
                        chat_type = 'channel'
                    elif hasattr(chat, 'gigagroup') and chat.gigagroup:
                        chat_type = 'gigagroup'
                    else:
                        chat_type = 'group'
                    
                    group_info = {
                        'name': dialog.name,
                        'id': dialog.id,
                        'type': chat_type,
                        'is_channel': dialog.is_channel,
                        'is_group': dialog.is_group,
                        'participants_count': getattr(chat, 'participants_count', 0),
                        'username': getattr(chat, 'username', None),
                        'admin_permissions': False
                    }
                    
                    # Verifica se é admin
                    try:
                        if chat_type in ['channel', 'supergroup', 'gigagroup']:
                            # Para canais e supergrupos
                            full_chat = await self.user_client(GetFullChannelRequest(chat))
                            if hasattr(full_chat, 'admins'):
                                admins = [admin.id for admin in full_chat.admins]
                                my_id = (await self.user_client.get_me()).id
                                group_info['admin_permissions'] = my_id in admins
                        else:
                            # Para grupos comuns
                            full_chat = await self.user_client(GetFullChatRequest(chat.id))
                            if hasattr(full_chat, 'admins'):
                                admins = [admin.id for admin in full_chat.admins]
                                my_id = (await self.user_client.get_me()).id
                                group_info['admin_permissions'] = my_id in admins
                    except:
                        pass
                    
                    groups.append(group_info)
                    
                except Exception as e:
                    print(f"   ⚠️  Erro ao processar {dialog.name}: {e}")
                    continue
            
            return groups
            
        except Exception as e:
            print(f"❌ Erro ao obter grupos: {e}")
            return []
    
    async def send_message_as_user(self, entity, message, **kwargs):
        """Envia mensagem como usuário"""
        if not self.user_client:
            raise Exception("Conta de usuário não conectada")
        return await self.user_client.send_message(entity, message, **kwargs)
    
    async def send_message_as_bot(self, entity, message, **kwargs):
        """Envia mensagem como bot"""
        if not self.bot_client:
            raise Exception("Bot não conectado")
        return await self.bot_client.send_message(entity, message, **kwargs)
    
    async def create_invite_link(self, chat_id):
        """Cria link de convite para um chat"""
        try:
            result = await self.user_client.create_chat_invite(chat_id)
            return result.link
        except Exception as e:
            print(f"❌ Erro ao criar link de convite: {e}")
            return None
    
    async def disconnect(self):
        """Desconecta ambos os clientes"""
        try:
            if self.user_client:
                await self.user_client.disconnect()
            if self.bot_client:
                await self.bot_client.disconnect()
        except:
            pass