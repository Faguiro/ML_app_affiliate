#!/usr/bin/env python3
"""
Script de diagnóstico para debugar detecção de links do Mercado Livre
"""
import sqlite3
import asyncio
import re
import json
import logging
from datetime import datetime
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.DEBUG,  # MUDADO PARA DEBUG
    format="%(asctime)s - %(levelname)s - %(funcName)s - %(message)s"
)
logger = logging.getLogger(__name__)


class MessageDebugger:
    def __init__(self, db_path, bot):
        self.db_path = db_path
        self.bot = bot
        
    def extract_urls_from_text(self, text: str) -> list[str]:
        """Versão com debug detalhado"""
        logger.debug(f"=" * 80)
        logger.debug(f"TEXTO RECEBIDO (tipo: {type(text)}):")
        logger.debug(f"Comprimento: {len(text) if text else 0}")
        logger.debug(f"Repr: {repr(text)}")
        logger.debug(f"Raw: {text}")
        logger.debug(f"=" * 80)
        
        if not text:
            logger.warning("⚠️ Texto vazio ou None!")
            return []

        # Mostra bytes do texto
        try:
            logger.debug(f"Bytes: {text.encode('utf-8')[:200]}")
        except Exception as e:
            logger.error(f"Erro ao codificar texto: {e}")

        # Limpa caracteres invisíveis
        original_text = text
        for ch in ("\u200b", "\u200c", "\u200d", "\ufeff"):
            text = text.replace(ch, "")
        
        if original_text != text:
            logger.info(f"🧹 Caracteres invisíveis removidos")
            logger.debug(f"Antes: {repr(original_text)}")
            logger.debug(f"Depois: {repr(text)}")

        urls = []
        seen = set()
        
        # Padrões de URL
        http_pattern = r'https?://[^\s<>()\[\]"\']+'
        www_pattern = r'www\.[^\s<>()\[\]"\']+'
        
        logger.debug(f"\n🔍 TESTANDO PADRÃO HTTP...")
        http_matches = re.findall(http_pattern, text)
        logger.debug(f"Matches HTTP encontrados: {len(http_matches)}")
        for match in http_matches:
            logger.debug(f"  → {match}")
        
        logger.debug(f"\n🔍 TESTANDO PADRÃO WWW...")
        www_matches = re.findall(www_pattern, text)
        logger.debug(f"Matches WWW encontrados: {len(www_matches)}")
        for match in www_matches:
            logger.debug(f"  → {match}")
        
        # Processa URLs com protocolo
        for url in http_matches:
            url = url.rstrip(".,;:!?)\"'")
            logger.debug(f"Processando HTTP URL: {url}")
            if url and url not in seen:
                seen.add(url)
                urls.append(url)
                logger.info(f"✅ URL HTTP adicionada: {url}")
        
        # Processa URLs com www
        for url in www_matches:
            url = url.rstrip(".,;:!?)\"'")
            full_url = f"https://{url}"
            logger.debug(f"Processando WWW URL: {url} → {full_url}")
            if full_url not in seen:
                seen.add(full_url)
                urls.append(full_url)
                logger.info(f"✅ URL WWW adicionada: {full_url}")
        
        logger.info(f"\n📊 RESULTADO FINAL: {len(urls)} URL(s) extraída(s)")
        for i, url in enumerate(urls, 1):
            logger.info(f"  {i}. {url}")
        
        return urls

    def is_trackable_link(self, url: str) -> bool:
        """Versão com debug detalhado"""
        logger.debug(f"\n🎯 VERIFICANDO SE É RASTREÁVEL:")
        logger.debug(f"URL: {url}")
        logger.debug(f"URL lower: {url.lower()}")
        
        is_ml = "mercadolivre" in url.lower()
        logger.debug(f"Contém 'mercadolivre': {is_ml}")
        
        # Testes adicionais
        variations = [
            "mercadolivre",
            "mercadolibre", 
            "mercadolivre.com.br",
            "mercadolivre.com",
            "produto.mercadolivre",
            "mlb-",
            "mlb",
        ]
        
        logger.debug(f"Testando variações:")
        for var in variations:
            if var in url.lower():
                logger.info(f"  ✅ Match encontrado: '{var}'")
                return True
            else:
                logger.debug(f"  ❌ Não contém: '{var}'")
        
        logger.warning(f"⚠️ URL NÃO é rastreável: {url}")
        return False

    async def debug_single_message(self, group_id, message_id=None):
        """Debug de uma mensagem específica"""
        logger.info(f"\n{'='*80}")
        logger.info(f"🐛 DEBUG DE MENSAGEM ÚNICA")
        logger.info(f"Grupo ID: {group_id}")
        logger.info(f"Message ID: {message_id or 'última mensagem'}")
        logger.info(f"{'='*80}\n")
        
        user_client = self.bot.telegram.user_client
        if not user_client:
            logger.error("❌ User client não disponível!")
            return

        try:
            if message_id:
                # Busca mensagem específica
                messages = await user_client.get_messages(group_id, ids=message_id)
                msg = messages if not isinstance(messages, list) else messages[0]
            else:
                # Pega última mensagem
                async for msg in user_client.iter_messages(group_id, limit=1):
                    break
            
            logger.info(f"📨 MENSAGEM CAPTURADA:")
            logger.info(f"  ID: {msg.id}")
            logger.info(f"  Data: {msg.date}")
            logger.info(f"  Remetente: {msg.sender_id}")
            logger.info(f"  Tipo: {type(msg)}")
            logger.info(f"  Tem texto: {bool(msg.text)}")
            logger.info(f"  Tem mídia: {bool(msg.media)}")
            logger.info(f"  Tem entities: {bool(msg.entities)}")
            
            if msg.text:
                logger.info(f"\n📝 TEXTO DA MENSAGEM:")
                logger.info(f"{msg.text}")
                
                # Extrai URLs
                urls = self.extract_urls_from_text(msg.text)
                
                if urls:
                    logger.info(f"\n🔗 PROCESSANDO {len(urls)} URL(S):")
                    for i, url in enumerate(urls, 1):
                        logger.info(f"\n--- URL {i} ---")
                        logger.info(f"URL: {url}")
                        
                        is_trackable = self.is_trackable_link(url)
                        logger.info(f"Rastreável: {is_trackable}")
                        
                        if is_trackable:
                            domain = self.get_domain_from_url(url)
                            logger.info(f"Domínio: {domain}")
                else:
                    logger.warning(f"⚠️ NENHUMA URL DETECTADA NO TEXTO!")
            else:
                logger.warning(f"⚠️ MENSAGEM SEM TEXTO!")
                
            # Verifica entities (links do Telegram)
            if msg.entities:
                logger.info(f"\n🔍 ENTITIES DETECTADAS:")
                for entity in msg.entities:
                    logger.info(f"  Tipo: {entity.type}")
                    logger.info(f"  Offset: {entity.offset}")
                    logger.info(f"  Length: {entity.length}")
                    if hasattr(entity, 'url'):
                        logger.info(f"  URL: {entity.url}")
                        
        except Exception as e:
            logger.error(f"❌ Erro ao buscar mensagem: {e}", exc_info=True)

    async def debug_recent_messages(self, group_id, limit=10):
        """Debug das últimas N mensagens do grupo"""
        logger.info(f"\n{'='*80}")
        logger.info(f"🐛 DEBUG DE MENSAGENS RECENTES")
        logger.info(f"Grupo ID: {group_id}")
        logger.info(f"Limite: {limit}")
        logger.info(f"{'='*80}\n")
        
        user_client = self.bot.telegram.user_client
        if not user_client:
            logger.error("❌ User client não disponível!")
            return

        try:
            msg_count = 0
            msgs_with_text = 0
            msgs_with_urls = 0
            total_urls = 0
            trackable_urls = 0
            
            async for msg in user_client.iter_messages(group_id, limit=limit):
                msg_count += 1
                logger.info(f"\n{'─'*80}")
                logger.info(f"📨 MENSAGEM #{msg_count} (ID: {msg.id})")
                logger.info(f"{'─'*80}")
                
                if msg.text:
                    msgs_with_text += 1
                    logger.info(f"Texto: {msg.text[:100]}...")
                    
                    urls = self.extract_urls_from_text(msg.text)
                    
                    if urls:
                        msgs_with_urls += 1
                        total_urls += len(urls)
                        
                        for url in urls:
                            if self.is_trackable_link(url):
                                trackable_urls += 1
                                logger.info(f"  ✅ URL RASTREÁVEL: {url}")
                            else:
                                logger.warning(f"  ❌ URL NÃO rastreável: {url}")
                else:
                    logger.info("⚠️ Mensagem sem texto")
            
            # Resumo
            logger.info(f"\n{'='*80}")
            logger.info(f"📊 RESUMO DO DEBUG")
            logger.info(f"{'='*80}")
            logger.info(f"Total de mensagens: {msg_count}")
            logger.info(f"Mensagens com texto: {msgs_with_text}")
            logger.info(f"Mensagens com URLs: {msgs_with_urls}")
            logger.info(f"Total de URLs encontradas: {total_urls}")
            logger.info(f"URLs rastreáveis (Mercado Livre): {trackable_urls}")
            logger.info(f"{'='*80}\n")
            
        except Exception as e:
            logger.error(f"❌ Erro ao buscar mensagens: {e}", exc_info=True)

    def get_domain_from_url(self, url):
        """Versão com debug"""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            logger.debug(f"Domain original: {domain}")
            
            if domain.startswith("www."):
                domain = domain[4:]
                logger.debug(f"Domain sem www: {domain}")
            
            return domain.lower()
        except Exception as e:
            logger.error(f"Erro ao extrair domínio de {url}: {e}")
            return None

    async def check_cursor_state(self, group_id):
        """Verifica estado do cursor"""
        logger.info(f"\n{'='*80}")
        logger.info(f"🔍 VERIFICANDO CURSOR DO GRUPO")
        logger.info(f"{'='*80}\n")
        
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            
            # Verifica cursor
            cur.execute(
                "SELECT last_message_id, updated_at FROM channel_cursor WHERE group_id = ?",
                (str(group_id),)
            )
            row = cur.fetchone()
            
            if row:
                logger.info(f"✅ Cursor encontrado:")
                logger.info(f"  Last Message ID: {row[0]}")
                logger.info(f"  Updated At: {row[1]}")
            else:
                logger.warning(f"⚠️ Nenhum cursor encontrado para este grupo")
            
            # Conta mensagens processadas
            cur.execute(
                "SELECT COUNT(*) FROM processed_messages WHERE group_jid = ?",
                (str(group_id),)
            )
            count = cur.fetchone()[0]
            logger.info(f"📊 Mensagens processadas: {count}")
            
            # Últimas mensagens processadas
            cur.execute("""
                SELECT message_id, processed_at 
                FROM processed_messages 
                WHERE group_jid = ? 
                ORDER BY processed_at DESC 
                LIMIT 5
            """, (str(group_id),))
            
            rows = cur.fetchall()
            if rows:
                logger.info(f"\n📝 Últimas mensagens processadas:")
                for msg_id, proc_at in rows:
                    logger.info(f"  ID {msg_id} em {proc_at}")
            
            conn.close()
            
        except Exception as e:
            logger.error(f"❌ Erro ao verificar cursor: {e}", exc_info=True)

    async def test_url_patterns(self):
        """Testa padrões de URL com exemplos"""
        logger.info(f"\n{'='*80}")
        logger.info(f"🧪 TESTE DE PADRÕES DE URL")
        logger.info(f"{'='*80}\n")
        
        test_cases = [
            "https://produto.mercadolivre.com.br/MLB-123456-produto-teste",
            "http://produto.mercadolivre.com.br/MLB-123456",
            "www.mercadolivre.com.br/produto/MLB-123456",
            "mercadolivre.com.br/p/MLB-123456",
            "Confira https://produto.mercadolivre.com.br/MLB-123456 muito bom!",
            "Link: produto.mercadolivre.com.br/MLB-123456",
            "https://lista.mercadolivre.com.br/produto",
            "produto.mercadolivre.com.br/MLB-3627848131-fone-de-ouvido-gamer-trust-gxt-488-forze-ps5-ps4-_JM",
        ]
        
        for i, test in enumerate(test_cases, 1):
            logger.info(f"\n--- TESTE {i} ---")
            logger.info(f"Input: {test}")
            urls = self.extract_urls_from_text(test)
            logger.info(f"URLs extraídas: {len(urls)}")
            
            for url in urls:
                is_track = self.is_trackable_link(url)
                logger.info(f"  {url} → {'✅ RASTREÁVEL' if is_track else '❌ NÃO rastreável'}")


# ============================================================
# FUNÇÕES DE TESTE
# ============================================================

async def run_debug(bot, group_id, db_path):
    """Executa bateria completa de testes"""
    debugger = MessageDebugger(db_path, bot)
    
    logger.info(f"\n{'#'*80}")
    logger.info(f"# INICIANDO DEBUG COMPLETO")
    logger.info(f"# Grupo: {group_id}")
    logger.info(f"# Database: {db_path}")
    logger.info(f"{'#'*80}\n")
    
    # 1. Testa padrões
    await debugger.test_url_patterns()
    
    # 2. Verifica cursor
    await debugger.check_cursor_state(group_id)
    
    # 3. Debug mensagens recentes
    await debugger.debug_recent_messages(group_id, limit=5)
    
    # 4. Debug última mensagem em detalhe
    await debugger.debug_single_message(group_id)
    
    logger.info(f"\n{'#'*80}")
    logger.info(f"# DEBUG FINALIZADO")
    logger.info(f"{'#'*80}\n")


if __name__ == "__main__":
    print("Este script deve ser importado e usado com seu bot.")
    print("\nExemplo de uso:")
    print("  from debug_message_detection import run_debug, MessageDebugger")
    print("  await run_debug(bot, group_id, db_path)")