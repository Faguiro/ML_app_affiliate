# test_fbot.py
import asyncio
import sys
from chat_bot import ChatBot

async def test_fbot():
    """Testa envio para o grupo FBot"""
        
    bot = ChatBot()    
    if not await bot.initialize():
        return
        
    print("\n🤖 TESTE NO GRUPO FBOT")
    print("="*50)
    
    # ID do grupo FBot (do seu output)
    fbot_id = -1003528813782  # Supergrupo com bot
    # fbot_id = -4948363691    # Grupo comum sem bot
    
    # Mensagem de teste
    message = """🎯 **TESTE DO BOT AFILIADO**

✅ Esta é a segunda mensagem de teste do sistema de afiliados!

🔗 **Funcionalidades testadas:**
   • Envio automático para grupos
   • Formatação Markdown
   • Links e previews

📊 *Em breve: ofertas exclusivas!*

#Teste #BotAfiliado"""
    
    print(f"\n📤 Enviando para FBot (ID: {fbot_id})")
    print(f"📝 Mensagem: {len(message)} caracteres")
    
    # Primeiro tenta como bot
    print("\n1️⃣  Tentando como BOT...")
    success_bot = await bot.send_message(fbot_id, message, as_bot=True)
    
    if not success_bot:
        print("\n2️⃣  Bot falhou, tentando como USUÁRIO...")
        success_user = await bot.send_message(fbot_id, message, as_bot=False)
    
    await bot.disconnect()
    
    if success_bot:
        print("\n✅ Teste concluído: Bot enviou com sucesso!")
    elif success_user:
        print("\n✅ Teste concluído: Usuário enviou com sucesso!")
    else:
        print("\n❌ Teste falhou em ambos os modos")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    asyncio.run(test_fbot())