#!/usr/bin/env python3
"""
Script para executar debug rápido da detecção de mensagens
Execute: python quick_debug.py
"""
import asyncio
import sys
from debug_message_detection import MessageDebugger

# ============================================================
# CONFIGURAÇÃO
# ============================================================

# SUBSTITUA ESTES VALORES:
GROUP_ID = -1001234567890  # ID do seu grupo de rastreio
DB_PATH = "seu_banco.db"   # Caminho do seu banco de dados

# ============================================================
# FUNÇÕES DE TESTE INDIVIDUAL
# ============================================================

async def test_1_url_patterns():
    """Teste 1: Valida se os padrões de regex funcionam"""
    print("\n" + "="*80)
    print("TESTE 1: Padrões de URL")
    print("="*80)
    
    # Cria um mock simples para teste sem bot
    class MockBot:
        class telegram:
            user_client = None
    
    debugger = MessageDebugger(DB_PATH, MockBot())
    await debugger.test_url_patterns()


async def test_2_text_extraction(sample_text):
    """Teste 2: Testa extração de URL de um texto específico"""
    print("\n" + "="*80)
    print("TESTE 2: Extração de URLs")
    print("="*80)
    
    class MockBot:
        class telegram:
            user_client = None
    
    debugger = MessageDebugger(DB_PATH, MockBot())
    
    print(f"\nTexto de entrada:")
    print(f"{sample_text}\n")
    
    urls = debugger.extract_urls_from_text(sample_text)
    
    print(f"\nResultado:")
    print(f"URLs encontradas: {len(urls)}")
    for i, url in enumerate(urls, 1):
        print(f"  {i}. {url}")
        is_track = debugger.is_trackable_link(url)
        print(f"     Rastreável: {'✅ SIM' if is_track else '❌ NÃO'}")


async def test_3_with_real_bot(bot):
    """Teste 3: Com bot real - verifica mensagens do grupo"""
    print("\n" + "="*80)
    print("TESTE 3: Mensagens Reais do Grupo")
    print("="*80)
    
    debugger = MessageDebugger(DB_PATH, bot)
    
    # Verifica cursor
    await debugger.check_cursor_state(GROUP_ID)
    
    # Debug últimas 10 mensagens
    await debugger.debug_recent_messages(GROUP_ID, limit=10)


async def test_4_single_message(bot, message_id=None):
    """Teste 4: Debug profundo de uma mensagem específica"""
    print("\n" + "="*80)
    print("TESTE 4: Debug de Mensagem Única")
    print("="*80)
    
    debugger = MessageDebugger(DB_PATH, bot)
    await debugger.debug_single_message(GROUP_ID, message_id)


# ============================================================
# MENU INTERATIVO
# ============================================================

def print_menu():
    print("\n" + "="*80)
    print("🐛 MENU DE DEBUG - Detecção de Links Mercado Livre")
    print("="*80)
    print("\n1. Testar padrões de URL (sem bot)")
    print("2. Testar extração de texto personalizado (sem bot)")
    print("3. Verificar últimas mensagens do grupo (requer bot)")
    print("4. Debug de mensagem específica (requer bot)")
    print("5. Executar bateria completa (requer bot)")
    print("0. Sair")
    print("\n" + "="*80)


async def interactive_menu(bot=None):
    """Menu interativo para debug"""
    while True:
        print_menu()
        choice = input("\nEscolha uma opção: ").strip()
        
        if choice == "0":
            print("\n👋 Encerrando...")
            break
            
        elif choice == "1":
            await test_1_url_patterns()
            input("\nPressione ENTER para continuar...")
            
        elif choice == "2":
            print("\nCole o texto da mensagem (ou deixe vazio para usar exemplo):")
            text = input("> ").strip()
            if not text:
                text = "Confira https://produto.mercadolivre.com.br/MLB-123456-produto-teste muito bom!"
            await test_2_text_extraction(text)
            input("\nPressione ENTER para continuar...")
            
        elif choice == "3":
            if not bot:
                print("\n❌ Esta opção requer o bot. Execute via seu script principal.")
            else:
                await test_3_with_real_bot(bot)
            input("\nPressione ENTER para continuar...")
            
        elif choice == "4":
            if not bot:
                print("\n❌ Esta opção requer o bot. Execute via seu script principal.")
            else:
                msg_id = input("ID da mensagem (ou vazio para última): ").strip()
                msg_id = int(msg_id) if msg_id else None
                await test_4_single_message(bot, msg_id)
            input("\nPressione ENTER para continuar...")
            
        elif choice == "5":
            if not bot:
                print("\n❌ Esta opção requer o bot. Execute via seu script principal.")
            else:
                from debug_message_detection import run_debug
                await run_debug(bot, GROUP_ID, DB_PATH)
            input("\nPressione ENTER para continuar...")
            
        else:
            print("\n❌ Opção inválida!")


# ============================================================
# TESTES ESPECÍFICOS PARA SEU PROBLEMA
# ============================================================

async def diagnose_ml_detection():
    """Diagnóstico focado no problema de não detectar links ML"""
    print("\n" + "#"*80)
    print("# DIAGNÓSTICO: Por que links do Mercado Livre não são detectados?")
    print("#"*80 + "\n")
    
    class MockBot:
        class telegram:
            user_client = None
    
    debugger = MessageDebugger(DB_PATH, MockBot())
    
    # Teste com vários formatos de link ML
    test_messages = [
        "https://produto.mercadolivre.com.br/MLB-3627848131-fone-de-ouvido",
        "produto.mercadolivre.com.br/MLB-3627848131-fone-de-ouvido",
        "www.mercadolivre.com.br/p/MLB-123456",
        "mercadolivre.com.br/ofertas",
        "Olha esse produto: https://produto.mercadolivre.com.br/MLB-123 top!",
        "https://produto.mercadolivre.com.br/MLB-123",
        "https://lista.mercadolivre.com.br/_CustId_123",
    ]
    
    problems = []
    
    for i, msg in enumerate(test_messages, 1):
        print(f"\n{'─'*80}")
        print(f"TESTE {i}/{len(test_messages)}")
        print(f"{'─'*80}")
        print(f"Mensagem: {msg}")
        
        # Extrai URLs
        urls = debugger.extract_urls_from_text(msg)
        
        if not urls:
            print(f"❌ PROBLEMA: Nenhuma URL detectada!")
            problems.append({
                'test': i,
                'msg': msg,
                'issue': 'URL não detectada pela regex'
            })
            continue
        
        print(f"✅ URLs detectadas: {len(urls)}")
        
        # Verifica se é rastreável
        for url in urls:
            is_track = debugger.is_trackable_link(url)
            print(f"  URL: {url}")
            print(f"  Rastreável: {'✅ SIM' if is_track else '❌ NÃO'}")
            
            if not is_track:
                problems.append({
                    'test': i,
                    'msg': msg,
                    'url': url,
                    'issue': 'URL detectada mas não identificada como Mercado Livre'
                })
    
    # Resumo dos problemas
    print(f"\n{'='*80}")
    print(f"📊 RESUMO DOS PROBLEMAS ENCONTRADOS")
    print(f"{'='*80}\n")
    
    if problems:
        print(f"❌ {len(problems)} problema(s) detectado(s):\n")
        for p in problems:
            print(f"Teste #{p['test']}:")
            print(f"  Mensagem: {p['msg']}")
            print(f"  Problema: {p['issue']}")
            if 'url' in p:
                print(f"  URL: {p['url']}")
            print()
    else:
        print("✅ Todos os testes passaram!")
    
    print(f"{'='*80}\n")


# ============================================================
# EXECUÇÃO
# ============================================================

if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════════════════════╗
║                   DEBUG - Detecção de Links Mercado Livre                  ║
╚════════════════════════════════════════════════════════════════════════════╝

IMPORTANTE: Configure GROUP_ID e DB_PATH no topo deste arquivo antes de usar!

Modos de uso:

1. TESTES SEM BOT (podem rodar agora):
   python quick_debug.py --test-patterns
   python quick_debug.py --diagnose

2. MENU INTERATIVO SEM BOT:
   python quick_debug.py

3. COM SEU BOT (integre ao seu código):
   from quick_debug import test_3_with_real_bot
   await test_3_with_real_bot(your_bot_instance)
""")
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--test-patterns":
            asyncio.run(test_1_url_patterns())
        elif sys.argv[1] == "--diagnose":
            asyncio.run(diagnose_ml_detection())
        else:
            print(f"❌ Argumento desconhecido: {sys.argv[1]}")
    else:
        asyncio.run(interactive_menu())