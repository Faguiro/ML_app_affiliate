#!/usr/bin/env python3
import sqlite3
import asyncio
import re
import json
import logging
from urllib.parse import urlparse, urlunparse
from datetime import datetime


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

URL_REGEX = re.compile(r"(https?://[^\s]+|www\.[^\s]+)", re.IGNORECASE)

class MessageMonitor:
    """
    Versão comportamentalmente idêntica ao código original:
    - iter_messages recebe group_id direto (sem get_entity)
    - cursor por grupo preservado
    - processed_messages preservado
    - parsing e leitura iguais

    Pipeline corrigida:
    - deduplicação via original_url UNIQUE
    - filtro por affiliate_domains
    - ordem determinística
    """

    def __init__(self, db_path, bot):
        self.db_path = db_path
        self.bot = bot

    # ========================================================
    # CURSOR POR GRUPO
    # ========================================================

    def get_last_message_id(self, group_id):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT last_message_id FROM channel_cursor WHERE group_id = ?",
            (str(group_id),)
        )
        row = cur.fetchone()
        conn.close()
        return row[0] if row else 0

    def save_last_message_id(self, group_id, message_id):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO channel_cursor (group_id, last_message_id)
            VALUES (?, ?)
            ON CONFLICT(group_id)
            DO UPDATE SET last_message_id = excluded.last_message_id,
                          updated_at = CURRENT_TIMESTAMP
            """,
            (str(group_id), int(message_id))
        )
        conn.commit()
        conn.close()

    # ========================================================
    # URL EXTRACTION (igual ao original)
    # ========================================================

    def extract_urls_from_text(self, text: str) -> list[str]:
        try:
            text = text.encode('latin1').decode('utf-8')
        except Exception:
            
            pass

        for ch in ("\u200b", "\u200c", "\u200d", "\ufeff"):
            text = text.replace(ch, "")

        urls = URL_REGEX.findall(text)
        return list(dict.fromkeys(urls))

    def canonicalize_url(self, url: str) -> str:
        p = urlparse(url)
        return urlunparse((p.scheme.lower(), p.netloc.lower(), p.path.rstrip('/'), '', '', ''))

    def get_domain(self, url: str) -> str:
        return urlparse(url).netloc.lower().replace('www.', '')

    # ========================================================
    # PROCESSED MESSAGES
    # ========================================================

    async def is_message_processed(self, message_id):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM processed_messages WHERE message_id = ?", (str(message_id),))
        exists = cur.fetchone() is not None
        conn.close()
        return exists

    async def mark_message_as_processed(self, message_id, group_id):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            "INSERT OR IGNORE INTO processed_messages (message_id, group_jid) VALUES (?, ?)",
            (str(message_id), str(group_id))
        )
        conn.commit()
        conn.close()

    # ========================================================
    # AFFILIATE DOMAINS
    # ========================================================

    def is_affiliate_domain(self, domain: str) -> bool:
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM affiliate_domains WHERE domain = ? AND is_active = 1",
            (domain,)
        )
        ok = cur.fetchone() is not None
        conn.close()
        return ok

    # ========================================================
    # TRACKED LINKS
    # ========================================================

    async def save_tracked_link(self, url, domain, group_id, text):
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()

        try:
            cur.execute(
                """
                INSERT INTO tracked_links (original_url, domain, group_jid, copy_text)
                VALUES (?, ?, ?, ?)
                """,
                (url, domain, str(group_id), text)
            )
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()

    # ========================================================
    # LEITURA DE GRUPO (IGUAL AO ORIGINAL)
    # ========================================================

    async def get_group_messages(self, group_id, limit=30):
        messages = []
        client = self.bot.telegram.user_client
        if not client:
            return messages

        last_id = self.get_last_message_id(group_id)
        logger.info(f"Last ID---> {last_id}")
        max_id_seen = last_id

        async for msg in client.iter_messages(
            entity=group_id,
            min_id=last_id,
            limit=limit
           
        ):
            if not msg.text:
                continue
            
            # logger.info(f"\n{msg}\n")
            max_id_seen = max(max_id_seen, msg.id)
            messages.append({
                "message_id": msg.id,
                "text": msg.text
            })

        if max_id_seen > last_id:
            self.save_last_message_id(group_id, max_id_seen)

        return messages

    # ========================================================
    # PROCESSAMENTO POR GRUPO
    # ========================================================


    async def process_group_messages(self, group):
        group_id = group['id']
        group_name = group.get('name', 'sem_nome')

        logger.info(f"[{group_name}|{group_id}] Iniciando leitura")

        messages = await self.get_group_messages(group_id)
        saved = 0
        msg_text =""
        for msg in messages:
            try:
                # Extrair o texto da mensagem
                raw_text = msg.get("text", "")
                
                # Se for dicionário, converter para string
                if isinstance(raw_text, dict):
                    # Extrair conteúdo textual do dicionário
                    msg_text = ""
                    for key, value in raw_text.items():
                        if isinstance(value, str):
                            msg_text += f"{value}\n"
                        elif isinstance(value, (int, float, bool)):
                            msg_text += f"{value}\n"
                        elif value is not None:
                            msg_text += f"{str(value)}\n"
                    msg_text = msg_text.strip()
                else:
                    msg_text = str(raw_text) if raw_text is not None else ""
                
                logger.info(f"[{group_name}|{group_id}] Processando mensagem --> {msg_text}")
            except :
                pass
                


            # if await self.is_message_processed(msg['message_id']):
            #     continue

            urls = self.extract_urls_from_text(msg_text)

            for url in urls:
                canonical = self.canonicalize_url(url)
                domain = self.get_domain(canonical)

                if not self.is_affiliate_domain(domain):
                    continue

                payload = json.dumps({
                    "text": msg_text,
                    "matchedText": url
                }, ensure_ascii=False)

                if await self.save_tracked_link(canonical, domain, group_id, payload):
                    saved += 1

            await self.mark_message_as_processed(msg['message_id'], group_id)

        if saved:
            logger.info(f"[{group_name}|{group_id}] {saved} link(s) salvo(s)")
        else:
            logger.info(f"[{group_name}|{group_id}] Nenhum link novo")

        return saved

    # ========================================================
    # LOOP PRINCIPAL (COMPATÍVEL)
    # ========================================================

    async def run(self, groups, interval=60):
        while True:
            total = 0
            for group in groups:
                try:
                    total += await self.process_group_messages(group)
                except Exception as e:
                    logger.error(f"Erro no grupo {group}: {e}")
                await asyncio.sleep(2)

            logger.info(f"TOTAL DO CICLO: {total}")
            await asyncio.sleep(interval)

    def monitor_groups(self, groups, check_interval=60):
        return self.run(groups, interval=check_interval)
