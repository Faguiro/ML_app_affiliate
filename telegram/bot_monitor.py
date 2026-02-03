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

from _telegram_sender import TelegramSender
from _message_monitor import MessageMonitor




# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)





async def main():
    """Função principal"""
    print("=" * 50)
    print("🤖 SISTEMA DE AFILIADOS COM METADATA")
    print("=" * 50)
    
    db_path = '../database/affiliate.db'
    
    try:
        sender = TelegramSender(
            db_path=db_path,
            check_interval=120  # 2 minutos
        )

        await sender.run()

        self.message_monitor = MessageMonitor(self.db_path, self.bot)
        monitor_task = asyncio.create_task(
                self.message_monitor.monitor_groups(tracking)
            )

    except KeyboardInterrupt:
        print("\n🛑 Programa interrompido pelo usuário")
    except Exception as e:
        print(f"\n❌ Erro fatal: {e}")
        import traceback
        traceback.print_exc()
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