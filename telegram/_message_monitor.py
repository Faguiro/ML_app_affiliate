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
    Monitor de mensagens com tratamento robusto de erros
    
    Versão corrigida com:
    - Try/except em todas operações de BD
    - Tratamento de erros na API do Telegram
    - Validação de dados
    - Logs detalhados
    """

    def __init__(self, db_path, bot):
        self.db_path = db_path
        self.bot = bot

    # ========================================================
    # CURSOR POR GRUPO (com tratamento de erro)
    # ========================================================

    def get_last_message_id(self, group_id):
        """Busca último ID processado do grupo"""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute(
                "SELECT last_message_id FROM channel_cursor WHERE group_id = ?",
                (str(group_id),)
            )
            row = cur.fetchone()
            return row[0] if row else 0
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao buscar cursor do grupo {group_id}: {e}")
            return 0
        finally:
            if conn:
                conn.close()

    def save_last_message_id(self, group_id, message_id):
        """Salva último ID processado do grupo"""
        conn = None
        try:
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
            return True
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao salvar cursor do grupo {group_id}: {e}")
            return False
        finally:
            if conn:
                conn.close()

    # ========================================================
    # URL EXTRACTION (com validação)
    # ========================================================

    def extract_urls_from_text(self, text: str) -> list[str]:
        """Extrai URLs do texto com normalização"""
        if not text or not isinstance(text, str):
            return []
        
        try:
            # Remove caracteres invisíveis
            for ch in ("\u200b", "\u200c", "\u200d", "\ufeff"):
                text = text.replace(ch, "")
            
            # Extrai URLs
            urls = URL_REGEX.findall(text)
            
            # Remove duplicatas mantendo ordem
            return list(dict.fromkeys(urls))
            
        except Exception as e:
            logger.error(f"❌ Erro ao extrair URLs: {e}")
            return []

    def canonicalize_url(self, url: str) -> str:
        """Canonicaliza URL (lowercase, sem trailing slash)"""
        try:
            if not url:
                return ""
            
            # Adiciona scheme se necessário
            if url.startswith('www.'):
                url = 'https://' + url
            
            p = urlparse(url)
            return urlunparse((
                p.scheme.lower(), 
                p.netloc.lower(), 
                p.path.rstrip('/'), 
                '', '', ''
            ))
        except Exception as e:
            logger.error(f"❌ Erro ao canonicalizar URL {url}: {e}")
            return url

    def get_domain(self, url: str) -> str:
        """Extrai domínio da URL"""
        try:
            domain = urlparse(url).netloc.lower()
            # Remove www.
            if domain.startswith('www.'):
                domain = domain[4:]
            return domain
        except Exception as e:
            logger.error(f"❌ Erro ao extrair domínio de {url}: {e}")
            return ""

    # ========================================================
    # PROCESSED MESSAGES (com tratamento de erro)
    # ========================================================

    async def is_message_processed(self, message_id):
        """Verifica se mensagem já foi processada"""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM processed_messages WHERE message_id = ?", 
                (str(message_id),)
            )
            exists = cur.fetchone() is not None
            return exists
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao verificar mensagem processada {message_id}: {e}")
            return False
        finally:
            if conn:
                conn.close()

    async def mark_message_as_processed(self, message_id, group_id):
        """Marca mensagem como processada"""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute(
                "INSERT OR IGNORE INTO processed_messages (message_id, group_jid) VALUES (?, ?)",
                (str(message_id), str(group_id))
            )
            conn.commit()
            return True
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao marcar mensagem {message_id} como processada: {e}")
            return False
        finally:
            if conn:
                conn.close()

    # ========================================================
    # AFFILIATE DOMAINS (com tratamento de erro)
    # ========================================================

    def is_affiliate_domain(self, domain: str) -> bool:
        """Verifica se domínio é de afiliado autorizado"""
        if not domain:
            return False
        
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM affiliate_domains WHERE domain = ? AND is_active = 1",
                (domain,)
            )
            ok = cur.fetchone() is not None
            return ok
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao verificar domínio {domain}: {e}")
            return False
        finally:
            if conn:
                conn.close()

    # ========================================================
    # TRACKED LINKS (com tratamento de erro)
    # ========================================================

    async def save_tracked_link(self, url, domain, group_id, text):
        """Salva link rastreado no banco"""
        if not url or not domain:
            logger.warning("⚠️  Tentativa de salvar link sem URL ou domínio")
            return False
        
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
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
            # URL duplicada (esperado)
            return False
        except sqlite3.Error as e:
            logger.error(f"❌ Erro ao salvar link {url}: {e}")
            return False
        finally:
            if conn:
                conn.close()

    # ========================================================
    # LEITURA DE GRUPO (com tratamento de erro)
    # ========================================================

    async def get_group_messages(self, group_id, limit=30):
        """Lê mensagens novas do grupo"""
        messages = []
        
        try:
            client = self.bot.telegram.user_client
            if not client:
                logger.error("❌ Cliente Telegram não disponível")
                return messages

            last_id = self.get_last_message_id(group_id)
            logger.debug(f"Último ID do grupo {group_id}: {last_id}")
            max_id_seen = last_id

            async for msg in client.iter_messages(
                entity=group_id,
                min_id=last_id,
                limit=limit
            ):
                try:
                    if not msg.text:
                        continue
                    
                    max_id_seen = max(max_id_seen, msg.id)
                    messages.append({
                        "message_id": msg.id,
                        "text": msg.text
                    })
                    
                except Exception as e:
                    logger.error(f"❌ Erro ao processar mensagem {msg.id}: {e}")
                    continue

            # Atualiza cursor se leu novas mensagens
            if max_id_seen > last_id:
                self.save_last_message_id(group_id, max_id_seen)

            return messages
            
        except Exception as e:
            logger.error(f"❌ Erro ao ler mensagens do grupo {group_id}: {e}", exc_info=True)
            return []

    # ========================================================
    # PROCESSAMENTO POR GRUPO (com tratamento de erro)
    # ========================================================

    async def process_group_messages(self, group):
        """Processa mensagens de um grupo"""
        try:
            group_id = group.get('id')
            group_name = group.get('name', 'sem_nome')
            
            if not group_id:
                logger.error("❌ Grupo sem ID")
                return 0

            logger.info(f"[{group_name}|{group_id}] Iniciando leitura")

            # Lê mensagens
            messages = await self.get_group_messages(group_id)
            
            if not messages:
                logger.debug(f"[{group_name}|{group_id}] Nenhuma mensagem nova")
                return 0

            saved = 0
            
            for msg in messages:
                try:
                    msg_id = msg.get("message_id")
                    raw_text = msg.get("text", "")
                    
                    # Normaliza texto
                    if isinstance(raw_text, dict):
                        # Se veio como dict, extrai valores textuais
                        msg_text = " ".join(
                            str(v) for v in raw_text.values() 
                            if isinstance(v, (str, int, float, bool))
                        )
                    else:
                        msg_text = str(raw_text) if raw_text is not None else ""
                    
                    if not msg_text.strip():
                        continue
                    
                    logger.debug(f"[{group_name}] Processando msg {msg_id}: {msg_text[:50]}...")
                    
                    # Extrai URLs
                    urls = self.extract_urls_from_text(msg_text)
                    
                    if not urls:
                        continue

                    # Processa cada URL
                    for url in urls:
                        try:
                            canonical = self.canonicalize_url(url)
                            domain = self.get_domain(canonical)

                            if not domain:
                                logger.debug(f"Domínio vazio para URL: {url}")
                                continue

                            if not self.is_affiliate_domain(domain):
                                logger.debug(f"Domínio não autorizado: {domain}")
                                continue

                            # Cria payload JSON
                            payload = json.dumps({
                                "text": msg_text,
                                "matchedText": url
                            }, ensure_ascii=False)

                            # Salva link
                            if await self.save_tracked_link(canonical, domain, group_id, payload):
                                saved += 1
                                logger.info(f"✅ Link salvo: {domain} ({canonical[:50]}...)")
                            else:
                                logger.debug(f"Link duplicado ou erro: {canonical}")
                                
                        except Exception as e:
                            logger.error(f"❌ Erro ao processar URL {url}: {e}")
                            continue

                    # Marca mensagem como processada
                    await self.mark_message_as_processed(msg_id, group_id)
                    
                except Exception as e:
                    logger.error(f"❌ Erro ao processar mensagem: {e}")
                    continue

            if saved > 0:
                logger.info(f"[{group_name}|{group_id}] ✅ {saved} link(s) salvo(s)")
            else:
                logger.debug(f"[{group_name}|{group_id}] Nenhum link novo")

            return saved
            
        except Exception as e:
            logger.error(f"❌ Erro ao processar grupo {group.get('name', 'unknown')}: {e}", exc_info=True)
            return 0

    # ========================================================
    # LOOP PRINCIPAL (com tratamento de erro)
    # ========================================================

    async def run(self, groups, interval=60):
        """Loop principal de monitoramento"""
        if not groups:
            logger.warning("⚠️  Nenhum grupo para monitorar")
            return
        
        logger.info(f"📡 Monitoramento iniciado em {len(groups)} grupo(s)")
        cycle_count = 0
        
        try:
            while True:
                cycle_count += 1
                logger.info(f"\n🔄 Ciclo de Monitoramento #{cycle_count} - {datetime.now().strftime('%H:%M:%S')}")
                
                total = 0
                
                for group in groups:
                    try:
                        total += await self.process_group_messages(group)
                        # Pequeno delay entre grupos
                        await asyncio.sleep(2)
                    except Exception as e:
                        logger.error(f"❌ Erro no grupo {group.get('name', 'unknown')}: {e}")
                        continue

                logger.info(f"📊 TOTAL DO CICLO: {total} link(s) encontrado(s)")
                logger.info(f"⏳ Próxima verificação em {interval} segundos...")
                
                await asyncio.sleep(interval)
                
        except asyncio.CancelledError:
            logger.info("🛑 Loop de monitoramento cancelado")
            raise
        except Exception as e:
            logger.error(f"❌ Erro fatal no loop de monitoramento: {e}", exc_info=True)
            raise

    def monitor_groups(self, groups, check_interval=60):
        """Wrapper para compatibilidade (retorna coroutine)"""
        return self.run(groups, interval=check_interval)