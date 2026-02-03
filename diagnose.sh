#!/bin/bash
echo "=== Diagnóstico ml-affiliate-app ==="

echo "1. Verificando diretório..."
ls -la /home/deploy/ML_affiliate_automate/

echo -e "\n2. Verificando virtualenv..."
ls -la /home/deploy/ML_affiliate_automate/venv/bin/python

echo -e "\n3. Testando imports Python..."
/home/deploy/ML_affiliate_automate/venv/bin/python -c "
try:
    import wsgi
    print('✓ wsgi import OK')
    app = wsgi.app
    print('✓ app object found')
except Exception as e:
    print('✗ Error:', str(e))
"

echo -e "\n4. Testando Gunicorn..."
timeout 5 /home/deploy/ML_affiliate_automate/venv/bin/gunicorn wsgi:app --workers 1 --threads 2 --bind 127.0.0.1:5000 &
sleep 3
pkill -f gunicorn

echo -e "\n5. Verificando porta 5000..."
netstat -tulpn | grep 5000

echo -e "\n6. PM2 status..."
pm2 show ml-affiliate-app
