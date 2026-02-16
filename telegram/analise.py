import sqlite3
import pandas as pd

# Caminho para o banco
db_path = "../database/affiliate.db"

# Conectar ao banco
conn = sqlite3.connect(db_path)

# Carregar tabelas em DataFrames
tracked_links = pd.read_sql_query("SELECT * FROM tracked_links;", conn)
telegram_sent = pd.read_sql_query("SELECT * FROM telegram_sent;", conn)

# Caso exista outra tabela chamada 'sent_links' ou similar
try:
    sent_links = pd.read_sql_query("SELECT * FROM sent_links;", conn)
except Exception as e:
    print("Tabela 'sent_links' não encontrada:", e)
    sent_links = None

conn.close()

# Inspeções básicas
print("=== tracked_links ===")
print(tracked_links.head())
print(tracked_links.info())

print("\n=== telegram_sent ===")
print(telegram_sent.head())
print(telegram_sent.info())

if sent_links is not None:
    print("\n=== sent_links ===")
    print(sent_links.head())
    print(sent_links.info())

# Exemplo de análise: quantos links estão com status 'sent'
print("\nContagem de status em tracked_links:")
print(tracked_links['status'].value_counts())

# Exemplo: verificar quais links 'sent' ainda não estão em telegram_sent
pending_check = tracked_links[tracked_links['status'] == 'sent'].merge(
    telegram_sent, how='left', left_on='id', right_on='tracked_link_id', indicator=True
)
print("\nLinks com status 'sent' mas não presentes em telegram_sent:")
print(pending_check[pending_check['_merge'] == 'left_only'])