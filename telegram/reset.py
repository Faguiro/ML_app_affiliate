#!/usr/bin/env python3
"""
Script para resetar sessões do Telegram e refazer login
"""
import os
import glob

def reset_sessions():
    """Remove todos os arquivos de sessão"""
    
    print("🔄 RESETANDO SESSÕES DO TELEGRAM")
    print("=" * 50)
    
    # Lista de arquivos a serem removidos
    files_to_remove = [
        'session.txt',           # String de sessão do user
        'my_account.session',    # Sessão do user
        'my_account.session-journal',
        'bot_session.session',   # Sessão do bot
        'bot_session.session-journal',
    ]
    
    removed_count = 0
    
    for filename in files_to_remove:
        if os.path.exists(filename):
            try:
                os.remove(filename)
                print(f"✅ Removido: {filename}")
                removed_count += 1
            except Exception as e:
                print(f"❌ Erro ao remover {filename}: {e}")
        else:
            print(f"⏭️  Não encontrado: {filename}")
    
    # Remove qualquer outro arquivo .session
    session_files = glob.glob('*.session*')
    for session_file in session_files:
        if session_file not in files_to_remove:
            try:
                os.remove(session_file)
                print(f"✅ Removido: {session_file}")
                removed_count += 1
            except Exception as e:
                print(f"❌ Erro ao remover {session_file}: {e}")
    
    print("=" * 50)
    print(f"📊 Total de arquivos removidos: {removed_count}")
    print("\n✅ Sessões resetadas com sucesso!")
    print("\n📝 PRÓXIMOS PASSOS:")
    print("1. Execute o programa novamente: python bot_monitor.py")
    print("2. Faça login com sua CONTA PESSOAL (não do bot)")
    print("3. Digite seu número: +55 21 99999-9999")
    print("4. Insira o código recebido no Telegram")
    print("5. Se tiver 2FA, digite a senha\n")

if __name__ == "__main__":
    confirm = input("⚠️  Tem certeza que deseja resetar as sessões? (s/n): ")
    
    if confirm.lower() in ['s', 'sim', 'y', 'yes']:
        reset_sessions()
    else:
        print("❌ Operação cancelada")
