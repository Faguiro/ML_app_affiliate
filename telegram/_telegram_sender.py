
#!/usr/bin/env python3
import sqlite3
import asyncio
import sys
import re
import json
import logging
import os
import aiohttp
from io import BytesIO
from urllib.parse import urlparse
from datetime import datetime, timedelta
import tempfile
from _message_monitor import MessageMonitor

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

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
        """Lógica CORRIGIDA: considerar canais onde pode postar"""
        try:
            all_chats = await self.bot.list_groups(include_channels=True, limit=100)
            
            # Consulta preferências manuais
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT chat_id, purpose FROM chat_preferences")
            prefs = {str(row[0]): row[1] for row in cursor.fetchall()}
            conn.close()

            destinations = []
            tracking = []

            for g in all_chats:
                cid = str(g["id"])
                chat_type = g.get("type", "")
                has_access = g.get("bot_has_access", False)
                
                # 1. PRIORIDADE: Decisão Manual (BD)
                if cid in prefs:
                    if prefs[cid] == 'destino': 
                        destinations.append(g)
                    else: 
                        tracking.append(g)
                    continue  # Pula decisão automática
                
                # 2. Decisão Automática
                if not has_access:
                    tracking.append(g)
                    continue
                
                # PARA CANAIS: se pode postar (não precisa ser admin)
                if chat_type == "channel":
                    # Testa se consegue postar (você já provou que consegue)
                    destinations.append(g)  # Assume que pode postar
                    
                # PARA GRUPOS: pode postar como membro
                else:
                    destinations.append(g)

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
                SELECT tl.id, tl.affiliate_link, tl.metadata, tl.copy_text
                FROM tracked_links tl
                WHERE tl.status = 'w-sent'
                LIMIT 5
            """)

            results = cursor.fetchall()
            conn.close()

            if results:
                print(f"🔍 {len(results)} link(s) com status='ready' encontrado(s)")
            else:
                # Debug: mostra status dos links no banco
                self._debug_link_status()
            
            return results

        except Exception as e:
            logger.error(f"Erro ao buscar links: {e}")
            return []

    def _debug_link_status(self):
        """Debug: mostra status dos links no banco"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT status, COUNT(*) as count 
                FROM tracked_links 
                GROUP BY status
            """)
            counts = cursor.fetchall()
            conn.close()
            
            if counts:
                status_dict = dict(counts)
                print(f"📊 Status dos links no banco: {status_dict}")
                
                # Verifica links pendentes
                if status_dict.get('pending', 0) > 0:
                    print(f"⚠️  {status_dict['pending']} link(s) pendentes")
                    print("   Eles precisam ser processados externamente para status='ready'")
            else:
                print("📊 Nenhum link encontrado no banco")
                
        except Exception as e:
            print(f"❌ Erro ao verificar status: {e}")

    async def debug_metadata_structure(self):
        """Debug para entender estrutura do metadata"""
        print("\n" + "="*60)
        print("🧪 ANALISANDO ESTRUTURA DO METADATA")
        print("="*60)
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT metadata FROM tracked_links 
                WHERE metadata IS NOT NULL 
                AND metadata != ''
                LIMIT 1
            """)
            result = cursor.fetchone()
            conn.close()
            
            if result and result[0]:
                metadata = result[0]
                try:
                    data = json.loads(metadata)
                    print("✅ METADATA ENCONTRADO (estrutura):")
                    print("-" * 50)
                    for key, value in data.items():
                        if isinstance(value, str) and len(value) > 100:
                            print(f"  {key}: {value[:100]}...")
                        else:
                            print(f"  {key}: {value}")
                    print("-" * 50)
                    return data
                except json.JSONDecodeError as e:
                    print(f"❌ Erro ao parsear JSON: {e}")
                    print(f"Conteúdo bruto: {metadata[:200]}...")
                    return None
            else:
                print("ℹ️  Nenhum metadata encontrado no banco")
                return None
                
        except Exception as e:
            print(f"❌ Erro ao buscar metadata: {e}")
            return None

    def mark_as_sent(self, link_id):
        """Registra envio no banco e atualiza status para 'complete'"""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 1. Registra na tabela telegram_sent
            cursor.execute("""
                INSERT OR IGNORE INTO telegram_sent (tracked_link_id) VALUES (?)
            """, (link_id,))
            
            # 2. Atualiza status do link para 'complete'
            cursor.execute("""
                UPDATE tracked_links 
                SET status = 'complete',
                    processed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (link_id,))
            
            conn.commit()
            logger.debug(f"✅ Link {link_id} marcado como 'complete'")
            return True
            
        except Exception as e:
            logger.error(f"❌ Erro ao marcar link {link_id} como enviado: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                conn.close()

   

    def create_message(self, affiliate_link, metadata, copy_text=None):
        if not metadata:
            return f"🛍️ Oferta Especial\n\n🔗 {affiliate_link}"

        try:
            meta = json.loads(metadata)

            title = meta.get("product_title") or meta.get("title") or "Oferta imperdível"
            price = meta.get("product_price")
            coupon = meta.get("cupom")
            ai_desc = meta.get("ai_description")

            parts = []

            # 📦 Título
            parts.append(f"📦 {title}")
            parts.append("")

            # ✨ Descrição boa (ignora description lixo)
            if ai_desc:
                #parts.append(f"✨ {ai_desc}")
                parts.append("")

            # 💰 Preço
            if price:
                try:
                    parts.append(f"💰 Preço: R$ {float(price):.2f}")
                    parts.append("")
                except:
                    parts.append(f"💰 Preço: R$ {price}")
                    parts.append("")

            # 🎟 Cupom
            if coupon:
                parts.append(f"🎟 Cupom de desconto: {coupon}")
                parts.append("")

            # 🛒 CTA
            parts.append("🛒 Comprar agora:")
            parts.append(f"👉 {affiliate_link}")
            parts.append("")
            parts.append("🛡️ Compra segura")

            return "\n".join(parts)

        except Exception as e:
            logger.error(f"Erro ao montar mensagem: {e}")
            return f"🛍️ Oferta Especial\n\n🔗 {affiliate_link}"



    async def extract_and_download_image(self, image_url):
        """Baixa imagem de uma URL e retorna os bytes"""
        if not image_url or image_url.startswith('data:image/'):
            return None
            
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(image_url, timeout=10) as response:
                    if response.status == 200:
                        image_data = await response.read()
                        return BytesIO(image_data)
                    else:
                        print(f"⚠️  Erro ao baixar imagem: HTTP {response.status}")
                        return None
        except Exception as e:
            print(f"⚠️  Erro ao baixar imagem: {e}")
            return None


    async def send_message_with_image(
        self,
        target,
        message,
        image_data=None,
        image_url=None
        ):
        try:
            chat_id = int(target["id"])

            # Sem imagem → delega direto
            if not image_data:
                return await self.send_to_target(target, message)

            import tempfile
            import os

            # Cria arquivo temporário da imagem
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                image_data.seek(0)
                tmp.write(image_data.read())
                tmp_path = tmp.name

            try:
                # Envio único com a legenda real
                result = await self.bot.telegram.bot_client.send_file(
                    chat_id,
                    tmp_path,
                    caption=message #[:1024]  # Telegram costuma aceitar até ~1024 chars em caption
                )
                
                # Log message
                self.bot._log_message(chat_id, message, as_bot=True, success=result is not None)

                return result is not None

            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        except Exception as e:
            print(f"Erro ao enviar imagem: {e}")
            return False

    
    async def send_to_target(self, target, message):
        """Envia mensagem para um destino"""
        try:
            await asyncio.sleep(1)  # Anti-flood básico
            
            # CONVERTE para inteiro
            chat_id = int(target["id"])

            success = await self.bot.send_message(
                chat_id,  # Já é inteiro
                message,
                as_bot=True,
                parse_mode='markdown'
            )

            self.bot._log_message(chat_id, message, as_bot=True, success=success)

            return bool(success)

        except Exception as e:
            logger.error(f"Erro ao enviar para {target['name']}: {e}")
            return False

            
    async def process_and_send_links(self):
        """Processa e envia links pendentes COM METADATA E IMAGEM"""
        new_links = self.get_new_sent_links()

        if not new_links:
            return 0
            
        if not self.telegram_targets:
            print("⚠️  Nenhum destino configurado para envio")
            return 0

        logger.info(f"📤 Preparando envio de {len(new_links)} link(s)")

        sent_count = 0

        for link_id, affiliate_link, metadata, copy_text in new_links:
            # Extrai imagem do metadata se disponível
            image_url = None
            image_data = None
            
            if metadata:
                try:
                    meta = json.loads(metadata)
                    image_url = meta.get('product_image') or meta.get('image')
                    logger.info(f"meta:--> {meta}")
                    logger.info(f"image_url:--> {image_url} ")
                    
                    if image_url:
                        print(f"🖼️  Imagem encontrada para link {link_id}: {image_url}")
                        # Baixa a imagem
                        image_data = await self.extract_and_download_image(image_url)
                        if image_data:
                            print(f"  ✅ Imagem baixada com sucesso")
                        else:
                            print(f"  ⚠️  Não foi possível baixar a imagem")
                except Exception as e:
                    print(f"⚠️  Erro ao extrair imagem: {e}")
            
            # Cria mensagem ENRIQUECIDA
            message = self.create_message(affiliate_link, metadata, copy_text)
            
            # DEBUG: Mostra preview da mensagem
            print(f"\n📨 MENSAGEM GERADA (link {link_id}):")
            print("-" * 40)
            print(message[:300] + "..." if len(message) > 300 else message)
            print("-" * 40)
            
            # Tenta enviar para cada destino
            target_success = False
            for target in self.telegram_targets[:3]:  # Limita a 3 destinos por link
                try:
                    print(f"  📤 Enviando para: {target.get('name', 'Desconhecido')}")
                    
                    # Envia mensagem COM ou SEM imagem - PASSANDO image_url
                    success = await self.send_message_with_image(target, message, image_data, image_url)
                    
                    if success:
                        target_success = True
                        print(f"  ✅ Sucesso!")
                    else:
                        print(f"  ❌ Falha no envio")
                    
                    await asyncio.sleep(20)  # Pausa entre envios
                    
                except Exception as e:
                    logger.error(f"Falha no envio para {target.get('name')}: {e}")
                    continue
            
            # Se enviou para pelo menos um destino, marca como enviado
            if target_success:
                self.mark_as_sent(link_id)
                sent_count += 1
                print(f"✅ Link {link_id} marcado como enviado")
            else:
                print(f"❌ Link {link_id} não foi enviado para nenhum destino")
            
            # Pausa maior entre links diferentes
            await asyncio.sleep(5)

        return sent_count
        
    async def test_message_generation(self):
        """Testa a geração de mensagens com metadata de exemplo"""
        print("\n" + "="*60)
        print("🧪 TESTANDO GERAÇÃO DE MENSAGENS COM METADATA")
        print("="*60)
        
        # Metadata de exemplo (baseado no seu modelo)
        example_metadata = {
            "product_title": "Kit Condor Masculino Speed Dourado - Co2115mwd/k4p Fundo Preto",
            "product_price": 179.99,
            "price_original": 339,
            "product_image": "https://http2.mlstatic.com/D_NQ_NP_2X_715808-MLA97591903165_112025-F.webp",
            "title": "Kit Condor Masculino Speed Dourado - Co2115mwd/k4p Fundo Preto",
            "description": "Visite a página e encontre todos os produtos de RENANPQD em um só lugar.",
            "price_to": "R$ 179,99",
            "image": "data:image/jpeg;base64,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",
            "affiliate_link": "https://mercadolivre.com/sec/322Lkxv",
            "ai_description": "⚡️ Design dourado que chama atenção e fundo preto que combina com tudo – perfeito pra quem curte estilo e praticidade. O kit reúne tudo que você precisa para montar seu visual com rapidez e qualidade. 🚀"
        }
        
        affiliate_link = "https://mercadolivre.com/sec/322Lkxv"
        
        # Testa criação da mensagem
        print("\n1. TESTE COM METADATA COMPLETO:")
        message1 = self.create_message(affiliate_link, json.dumps(example_metadata))
        print("-" * 40)
        print(message1[:500] + "..." if len(message1) > 500 else message1)
        print("-" * 40)
        
        print("\n2. TESTE COM METADATA MÍNIMO:")
        minimal_metadata = {
            "product_title": "Produto Teste",
            "product_price": 99.90
        }
        message2 = self.create_message(affiliate_link, json.dumps(minimal_metadata))
        print("-" * 40)
        print(message2)
        print("-" * 40)
        
        print("\n3. TESTE SEM METADATA:")
        message3 = self.create_message(affiliate_link, None)
        print("-" * 40)
        print(message3)
        print("-" * 40)
        
        print("\n✅ Teste de geração de mensagens concluído!")

    async def run(self):
        print("=" * 50)
        print("🚀 SISTEMA DE AFILIADOS COM METADATA")
        print("=" * 50)

        # 1. Testa estrutura do metadata no banco
        await self.debug_metadata_structure()
        
        # 2. Testa geração de mensagens
        await self.test_message_generation()
        
        if not await self.initialize(): 
            print("❌ Falha na inicialização do bot")
            return

        # 3. Separa os grupos
        destinations, tracking = await self.refresh_telegram_targets()

        # 4. Inicia Monitoramento
        monitor_task = None
        if tracking:
            self.message_monitor = MessageMonitor(self.db_path, self.bot)
            monitor_task = asyncio.create_task(
                self.message_monitor.monitor_groups(tracking)
            )
            print(f"\n📡 Monitoramento iniciado em {len(tracking)} grupos")

        # 5. Loop de Envio
        print(f"\n🎯 {len(destinations)} destinos configurados para envio")
        print("⏰ Intervalo de verificação: {} segundos".format(self.check_interval))
        print("\n" + "="*50)
        
        try:
            cycle_count = 0
            while True:
                cycle_count += 1
                print(f"\n🔄 Ciclo #{cycle_count} - {datetime.now().strftime('%H:%M:%S')}")
                
                if self.telegram_targets:
                    sent = await self.process_and_send_links()
                    if sent > 0: 
                        print(f"\n✅ {sent} link(s) postado(s) com sucesso!")
                    else:
                        print("ℹ️  Nenhum novo link para enviar")
                else:
                    print("⚠️  Nenhum destino configurado para envio")
                    print("   Aguardando destinos...")
                    # Tenta recarregar destinos
                    destinations, tracking = await self.refresh_telegram_targets()
                
                print(f"⏳ Próxima verificação em {self.check_interval} segundos...")
                await asyncio.sleep(self.check_interval)
                
        except KeyboardInterrupt:
            print("\n\n🛑 Interrupção solicitada pelo usuário")
            if monitor_task: 
                monitor_task.cancel()
                print("📡 Monitoramento interrompido")
            await self.bot.disconnect()
            print("🤖 Bot desconectado")
        except Exception as e:
            print(f"\n❌ Erro fatal no loop principal: {e}")
            if monitor_task: 
                monitor_task.cancel()
            await self.bot.disconnect()
