#!/usr/bin/env python3
import sqlite3
import asyncio
import sys
import re
import logging
from urllib.parse import urlparse
from datetime import datetime, timedelta

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

class MessageMonitor:
    """Monitora mensagens em grupos para capturar links afiliados"""
    def __init__(self, db_path, bot):
        self.db_path = db_path
        self.bot = bot
        self.affiliate_domains = []
        self.user_id_cache = None
        self.bot_id_cache = None

    def load_affiliate_domains(self):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT domain, affiliate_code FROM affiliate_domains WHERE is_active = 1")
            self.affiliate_domains = cursor.fetchall()
            conn.close()
            logger.info(f"Domínios carregados: {len(self.affiliate_domains)}")
        except Exception as e:
            logger.error(f"Erro ao carregar domínios: {e}")

    def extract_urls_from_text(self, text):
        """Extrai URLs de um texto"""
        if not text or not isinstance(text, str):
            return []

        # Regex simples para URLs
        url_pattern = r'https?://[^\s<>"]+|www\.[^\s<>"]+'
        urls = re.findall(url_pattern, text)

        # Normaliza URLs
        processed_urls = []
        for url in urls:
            if url.startswith('www.'):
                url = 'https://' + url
            processed_urls.append(url)

        return list(set(processed_urls))

    def get_domain_from_url(self, url):
        """Extrai domínio de uma URL"""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc

            if not domain and parsed.path:
                domain = parsed.path.split('/')[0]

            # Remove www.
            if domain and domain.startswith('www.'):
                domain = domain[4:]

            return domain.lower() if domain else None
        except:
            return None

    def is_affiliate_domain(self, url):
        """Verifica se é domínio afiliado"""
        domain = self.get_domain_from_url(url)
        if not domain:
            return False, None

        for affiliate_domain, affiliate_code in self.affiliate_domains:
            if domain == affiliate_domain.lower():
                return True, affiliate_code

        return False, None

    async def is_message_processed(self, message_id):
        """Verifica se mensagem já foi processada"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                "SELECT 1 FROM processed_messages WHERE message_id = ?",
                (str(message_id),)
            )

            exists = cursor.fetchone() is not None
            conn.close()

            return exists

        except Exception as e:
            logger.error(f"Erro ao verificar mensagem: {e}")
            return False

    async def mark_message_as_processed(self, message_id, group_jid):
        """Marca mensagem como processada"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """INSERT OR IGNORE INTO processed_messages
                   (message_id, group_jid) VALUES (?, ?)""",
                (str(message_id), group_jid)
            )

            conn.commit()
            conn.close()
            return True

        except Exception as e:
            logger.error(f"Erro ao marcar mensagem: {e}")
            return False

    async def save_tracked_link(self, original_url, domain, group_jid, sender_name=None, copy_text=None):
        """Salva link detectado"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Verifica se já existe
            cursor.execute(
                "SELECT id FROM tracked_links WHERE original_url = ?",
                (original_url,)
            )

            if cursor.fetchone():
                conn.close()
                return None

            # Insere novo link
            cursor.execute("""
                INSERT INTO tracked_links
                (original_url, domain, group_jid, sender_name, copy_text, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            """, (original_url, domain, group_jid, sender_name,
                  (copy_text or '')[:500]))

            link_id = cursor.lastrowid
            conn.commit()
            conn.close()

            logger.info(f"Link salvo: {domain}")
            return link_id

        except Exception as e:
            logger.error(f"Erro ao salvar link: {e}")
            return None

    async def get_cached_ids(self):
        """Obtém IDs em cache para evitar múltiplas chamadas"""
        if self.user_id_cache is None and self.bot.telegram.user_client:
            try:
                user_me = await self.bot.telegram.user_client.get_me()
                self.user_id_cache = user_me.id
            except:
                self.user_id_cache = 0

        if self.bot_id_cache is None and self.bot.telegram.bot_me:
            self.bot_id_cache = self.bot.telegram.bot_me.id

        return self.user_id_cache, self.bot_id_cache

    async def get_group_messages(self, group_id, limit=5):
        """
        Obtém mensagens recentes de um grupo (OTIMIZADO)
        """
        messages = []

        try:
            user_client = self.bot.telegram.user_client
            if not user_client:
                return messages

            # Obtém IDs em cache
            user_id, bot_id = await self.get_cached_ids()

            # Time limite: últimos 30 minutos
            since_time = datetime.now() - timedelta(minutes=30)

            try:
                async for message in user_client.iter_messages(
                    entity=group_id,
                    limit=limit,
                    offset_date=since_time,
                    reverse=True
                ):
                    # Ignora mensagens sem texto
                    if not message.text:
                        continue

                    # Verifica se é do bot
                    sender_id = None
                    if hasattr(message, 'sender_id'):
                        if hasattr(message.sender_id, 'user_id'):
                            sender_id = message.sender_id.user_id
                        elif isinstance(message.sender_id, int):
                            sender_id = message.sender_id

                    # Ignora mensagens do próprio bot
                    if sender_id in (user_id, bot_id):
                        continue

                    # Texto da mensagem
                    text = message.text
                    if len(text.strip()) < 10:  # Ignora mensagens muito curtas
                        continue

                    # Ignora mensagens que parecem ser do sistema
                    if text.startswith(('🛍️', '🔗', '✅')):
                        continue

                    messages.append({
                        'group_id': group_id,
                        'sender_id': sender_id,
                        'text': text,
                        'message_id': message.id,
                        'timestamp': message.date.isoformat() if message.date else datetime.now().isoformat()
                    })

            except Exception as e:
                logger.warning(f"Erro ao buscar mensagens do grupo {group_id}: {e}")

        except Exception as e:
            logger.error(f"Erro geral: {e}")

        return messages

    async def process_group_messages(self, group):
        """Processa mensagens de um único grupo"""
        group_id = group.get('id')
        if not group_id:
            return 0

        saved_count = 0

        # Obtém mensagens do grupo
        messages = await self.get_group_messages(group_id, limit=3)  # Apenas 3 mensagens

        for msg in messages:
            message_id = msg['message_id']
            text = msg['text']
            group_jid = msg['group_id']

            print(f"🔎 Processando mensagem {message_id} do grupo {group_jid}")
            print(f"📄 Texto: {text[:150]}...")

            # Verifica se já processou
            if await self.is_message_processed(message_id):
                continue

            # Extrai URLs
            urls = self.extract_urls_from_text(text)

            for url in urls:
                # Verifica se é domínio afiliado
                is_affiliate, affiliate_code = self.is_affiliate_domain(url)

                if is_affiliate:
                    domain = self.get_domain_from_url(url)

                    # Salva no banco
                    link_id = await self.save_tracked_link(
                        original_url=url,
                        domain=domain,
                        group_jid=group_jid,
                        sender_name=None,  # Não busca nome para economizar recursos
                        copy_text=text[:300]
                    )

                    if link_id:
                        saved_count += 1

            # Marca como processada
            await self.mark_message_as_processed(message_id, group_jid)

        return saved_count

    async def monitor_groups(self, groups, check_interval=180):
        logger.info(f"Iniciando monitoramento de {len(groups)} fontes de rastreio")
        self.load_affiliate_domains()
        if not self.affiliate_domains: return

        try:
            while True:
                total_saved = 0
                for group in groups:
                    saved = await self.process_group_messages(group)
                    total_saved += saved
                    await asyncio.sleep(2)
                
                if total_saved > 0:
                    logger.info(f"Links capturados no ciclo: {total_saved}")
                await asyncio.sleep(check_interval)
        except Exception as e:
            logger.error(f"Erro no monitoramento: {e}")


class TelegramSender:
    def __init__(self, db_path='../database/affiliate.db', check_interval=120):
        self.db_path = db_path
        self.check_interval = check_interval
        from chat_bot import ChatBot
        self.bot = ChatBot()
        self.telegram_targets = []  # Onde postar
        self.tracking_sources = []  # Onde rastrear
        self._init_db()

    def _init_db(self):
        """Cria tabelas de suporte se não existirem"""
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_preferences (
                chat_id TEXT PRIMARY KEY,
                purpose TEXT CHECK(purpose IN ('destino', 'rastreio')),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()

    async def initialize(self):
        return await self.bot.initialize()

    async def refresh_telegram_targets(self):
        """Lógica de Separação: Manual (BD) > Automática (Admin)"""
        try:
            # Lista todos sem filtro restrito
            all_chats = await self.bot.list_groups(include_channels=True, limit=100)
            
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT chat_id, purpose FROM chat_preferences")
            prefs = {str(row[0]): row[1] for row in cursor.fetchall()}
            conn.close()

            destinations = []
            tracking = []

            for g in all_chats:
                cid = str(g["id"])
                
                # 1. Decisão Manual
                if cid in prefs:
                    if prefs[cid] == 'destino': destinations.append(g)
                    else: tracking.append(g)
                # 2. Decisão Automática
                else:
                    if g.get("bot_has_access") and g.get("admin_permissions"):
                        destinations.append(g)
                    else:
                        tracking.append(g)

            self.telegram_targets = destinations
            self.tracking_sources = tracking
            logger.info(f"Filtro: {len(destinations)} Destinos | {len(tracking)} Rastreios")
            return destinations, tracking
        except Exception as e:
            logger.error(f"Erro ao atualizar alvos: {e}")
            return [], []

    def get_new_sent_links(self):
        """Busca links prontos para envio"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute("""
                SELECT tl.id, tl.affiliate_link, tl.metadata
                FROM tracked_links tl
                WHERE tl.status = 'ready'
                AND NOT EXISTS (
                    SELECT 1 FROM telegram_sent ts
                    WHERE ts.tracked_link_id = tl.id
                )
                LIMIT 5  -- Limita a 5 links por ciclo
            """)

            results = cursor.fetchall()
            conn.close()

            print(
                f"🔍 Consultando links prontos para envio ao Telegram... "
                f"{len(results)} link(s) encontrado(s)"
            )

            return results

        except Exception as e:
            logger.error(f"Erro ao buscar links: {e}")
            return []

    def mark_as_sent(self, link_id):
        """Registra envio no banco"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute("""
                INSERT OR IGNORE INTO telegram_sent (tracked_link_id) VALUES (?)
            """, (link_id,))

            conn.commit()
            conn.close()
            return True

        except Exception as e:
            logger.error(f"Erro ao marcar como enviado: {e}")
            return False

    def create_message(self, affiliate_link, metadata):
        """Cria mensagem simples"""
        try:
            # Tenta extrair metadata
            product_title = 'Oferta Especial'
            if metadata:
                try:
                    import ast
                    meta = ast.literal_eval(metadata)
                    product_title = meta.get('product_title', product_title)
                except:
                    pass

            return (
                f"🛍️ **{product_title}**\n\n"
                f"🔗 {affiliate_link}\n\n"
                f"✅ Recomendação do sistema"
            )
        except:
            return f"🛍️ Oferta especial!\n\n🔗 {affiliate_link}"

    async def send_to_target(self, target, message):
        """Envia mensagem para um destino"""
        try:
            await asyncio.sleep(1)  # Anti-flood básico

            success = await self.bot.send_message(
                str(target["id"]),
                message,
                as_bot=True,
                parse_mode='markdown'
            )

            return bool(success)

        except Exception as e:
            logger.error(f"Erro ao enviar para {target['name']}: {e}")
            return False

    async def process_and_send_links(self):
        """Processa e envia links pendentes"""
        new_links = self.get_new_sent_links()

        if not new_links or not self.telegram_targets:
            return 0

        logger.info(f"Links para enviar: {len(new_links)}")

        sent_count = 0

        for link_id, affiliate_link, metadata in new_links:
            message = self.create_message(affiliate_link, metadata)

            # Tenta enviar para cada destino
            target_success = False
            for target in self.telegram_targets[:3]:  # Limita a 3 destinos por link
                try:
                    if await self.send_to_target(target, message):
                        target_success = True
                        logger.info(f"✅ Enviado para {target['name']}")

                    # Pausa entre envios para o mesmo link
                    await asyncio.sleep(2)

                except Exception as e:
                    logger.error(f"Falha no envio: {e}")
                    continue

            # Se enviou para pelo menos um destino, marca como enviado
            if target_success:
                self.mark_as_sent(link_id)
                sent_count += 1

            # Pausa maior entre links diferentes
            await asyncio.sleep(5)

        return sent_count

    async def run(self):
        print("=" * 50)
        print("🚀 SISTEMA DE AFILIADOS INICIADO")
        print("=" * 50)

        if not await self.initialize(): return

        # Separa os grupos
        destinations, tracking = await self.refresh_telegram_targets()

        # Inicia Monitoramento (em background)
        monitor_task = None
        if tracking:
            self.message_monitor = MessageMonitor(self.db_path, self.bot)
            monitor_task = asyncio.create_task(
                self.message_monitor.monitor_groups(tracking)
            )

        # Loop de Envio
        try:
            while True:
                if self.telegram_targets:
                    sent = await self.process_and_send_links()
                    if sent > 0: print(f"📤 {sent} link(s) postado(s) nos seus canais.")
                
                await asyncio.sleep(self.check_interval)
        except KeyboardInterrupt:
            if monitor_task: monitor_task.cancel()
            await self.bot.disconnect()


async def main():
    """Função principal"""
    print("=" * 50)
    print("🤖 SISTEMA OTIMIZADO")
    print("=" * 50)
    db_path='../database/affiliate.db'

    try:
        sender = TelegramSender(
            db_path=db_path,
            check_interval=120  # 2 minutos
        )

        await sender.run()

    except KeyboardInterrupt:
        print("\n🛑 Programa interrompido")
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        return 1

    return 0



if __name__ == "__main__":
    # Configuração para Windows
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(
            asyncio.WindowsSelectorEventLoopPolicy()
        )

    # Executa
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
