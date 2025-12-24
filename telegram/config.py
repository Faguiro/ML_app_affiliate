# config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Telegram API Configuration
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    TELEGRAM_API_ID = os.getenv('TELEGRAM_API_ID')
    TELEGRAM_API_HASH = os.getenv('TELEGRAM_API_HASH')
    
    # Database Configuration
    DATABASE_PATH = 'affiliate.db'
    
    # Scheduler Configuration
    CHECK_INTERVAL_MINUTES = 30  # Verificar novos links a cada 30 minutos
    MAX_MESSAGES_PER_DAY = 100   # Limite diário de mensagens
    
    # Message Template
    MESSAGE_TEMPLATE = """
🎯 **{title}**

{description}

💰 Preço: {price}
{discount_info}
🔗 Link: {url}

#Oferta #{category}
    """