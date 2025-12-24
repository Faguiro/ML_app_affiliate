# telegram_sender.py
import sqlite3
import asyncio
import sys
from chat_bot import ChatBot


class TelegramSender:
    def __init__(self, db_path='../database/affiliate.db', check_interval=30):
        self.db_path = db_path
        self.check_interval = check_interval
        self.bot = ChatBot()
        self.telegram_targets = []

    # ------------------------------------------------------------------
    # INICIALIZAÇÃO
    # ------------------------------------------------------------------
    async def initialize(self):
        """Inicializa conexão com Telegram"""
        return await self.bot.initialize()

    # ------------------------------------------------------------------
    # DESCOBERTA / ATUALIZAÇÃO DE DESTINOS
    # ------------------------------------------------------------------
    def get_valid_telegram_targets(self, groups):
        """
        Filtra grupos/canais onde o bot pode enviar mensagens
        """
        valid_targets = []

        for g in groups:
            if g.get("bot_has_access") is True and (
                g.get("is_group") is True or g.get("is_channel") is True
            ):
                valid_targets.append({
                    "id": g["id"],
                    "name": g["name"],
                    "type": g["type"]
                })

        return valid_targets

    async def refresh_telegram_targets(self):
        """
        Atualiza dinamicamente os grupos/canais válidos para envio
        Executado no startup e sempre que houver links para enviar
        """
        try:
            groups = await self.bot._menu_list_groups(2)
            new_targets = self.get_valid_telegram_targets(groups)

            if new_targets:
                self.telegram_targets = new_targets
                print(f"🔄 Destinos Telegram atualizados: {len(new_targets)} grupo(s)")
            else:
                print("⚠️ Atualização executada, mas nenhum destino válido encontrado")

        except Exception as e:
            print(f"❌ Erro ao atualizar destinos Telegram: {e}")

    # ------------------------------------------------------------------
    # BANCO DE DADOS
    # ------------------------------------------------------------------
    def get_new_sent_links(self):
        """Busca links prontos para envio ao Telegram"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        query = """
        SELECT tl.id, tl.affiliate_link, tl.metadata, tl.processed_at
        FROM tracked_links tl
        WHERE tl.status = 'ready'
        AND NOT EXISTS (
            SELECT 1 FROM telegram_sent ts 
            WHERE ts.tracked_link_id = tl.id
        )
        ORDER BY tl.created_at DESC
        LIMIT 10
        """

        cursor.execute(query)
        results = cursor.fetchall()
        conn.close()

        print(
            f"🔍 Consultando links prontos para envio ao Telegram... "
            f"{len(results)} link(s) encontrado(s)"
        )

        return results

    def mark_as_sent_to_telegram(self, link_id):
        """Registra envio no banco"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_sent (
                id INTEGER PRIMARY KEY,
                tracked_link_id INTEGER UNIQUE,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tracked_link_id) REFERENCES tracked_links(id)
            )
        """)

        cursor.execute(
            "INSERT OR IGNORE INTO telegram_sent (tracked_link_id) VALUES (?)",
            (link_id,)
        )

        conn.commit()
        conn.close()

    # ------------------------------------------------------------------
    # MENSAGEM
    # ------------------------------------------------------------------
    def create_telegram_message(self, affiliate_link, metadata):
        """Cria mensagem formatada para Telegram"""
        try:
            meta = eval(metadata) if metadata else {}
            product_title = meta.get('product_title', 'Oferta Especial')

            return (
                f"🛍️ **{product_title}**\n\n"
                f"🔗 {affiliate_link}\n\n"
                f"⚡ Oferta exclusiva do grupo!\n"
                f"✅ Compra 100% segura\n"
                f"🚚 Entrega para todo Brasil\n\n"
                f"📊 *Recomendação validada pelo sistema*"
            )

        except Exception:
            return (
                "🛍️ Oferta especial!\n\n"
                f"🔗 {affiliate_link}\n\n"
                "✅ Recomendação do sistema"
            )

    # ------------------------------------------------------------------
    # ENVIO
    # ------------------------------------------------------------------
    async def send_to_telegram(self, chat_id, message):
        """Envia mensagem para um grupo/canal"""
        try:
            success = await self.bot.send_message(
                chat_id,
                message,
                as_bot=True
            )
            return bool(success)

        except Exception as e:
            print(f"❌ Erro Telegram ({chat_id}): {e}")
            return False

    # ------------------------------------------------------------------
    # LOOP PRINCIPAL
    # ------------------------------------------------------------------
    async def run_monitor(self):
        print("🤖 Monitor Telegram iniciado...")

        if not await self.initialize():
            print("❌ Falha ao conectar ao Telegram")
            return

        # Atualização inicial de destinos
        await self.refresh_telegram_targets()

        if not self.telegram_targets:
            print("⚠️ Nenhum grupo ou canal com permissão para envio")
            return

        print(f"✅ {len(self.telegram_targets)} destino(s) inicial(is) carregado(s)")

        # Loop contínuo
        while True:
            try:
                new_links = self.get_new_sent_links()

                if new_links:
                    # 🔄 Atualiza destinos SOMENTE se houver links
                    await self.refresh_telegram_targets()

                    if not self.telegram_targets:
                        print("⚠️ Nenhum destino válido após atualização")
                        await asyncio.sleep(self.check_interval)
                        continue

                    print(f"📥 {len(new_links)} link(s) para envio")

                    for link in new_links:
                        link_id, affiliate_link, metadata, sent_at = link
                        message = self.create_telegram_message(
                            affiliate_link,
                            metadata
                        )

                        # Envio multicast
                        for target in self.telegram_targets:
                            sent = await self.send_to_telegram(
                                target["id"],
                                message
                            )

                            if sent:
                                print(
                                    f"✅ Enviado para {target['name']} [{target['id']}]"
                                )
                            else:
                                print(
                                    f"❌ Falha ao enviar para {target['name']} [{target['id']}]"
                                )

                            await asyncio.sleep(1.5)  # anti-flood

                        # Marca link como enviado após envio a todos os destinos
                        self.mark_as_sent_to_telegram(link_id)

                await asyncio.sleep(self.check_interval)

            except Exception as e:
                print(f"⚠️ Erro no monitor: {e}")
                await asyncio.sleep(self.check_interval)


# ----------------------------------------------------------------------
# ENTRYPOINT
# ----------------------------------------------------------------------
async def main():
    sender = TelegramSender(check_interval=30)
    await sender.run_monitor()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(
            asyncio.WindowsSelectorEventLoopPolicy()
        )

    asyncio.run(main())
