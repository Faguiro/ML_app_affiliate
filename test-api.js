// test-api.js
import fetch from 'node-fetch';

async function testAPI() {
    console.log('🧪 Testando conexão com API...\n');
    
    const testUrl = 'https://www.mercadolivre.com.br/uno-r3-smd-chip-compativel-arduino/p/MLB38492604';
    
    const tests = [
        {
            name: 'Teste 1: Request simples',
            options: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_url: testUrl })
            }
        },
        {
            name: 'Teste 2: Com User-Agent e keepalive',
            options: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ product_url: testUrl }),
                keepalive: true
            }
        },
        {
            name: 'Teste 3: Com timeout curto (5s)',
            options: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_url: testUrl }),
                timeout: 5000
            }
        }
    ];
    
    for (const test of tests) {
        console.log(`\n${test.name}:`);
        console.log(`URL: https://grupossd.xyz/generate`);
        
        const startTime = Date.now();
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch('https://grupossd.xyz/generate', {
                ...test.options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const endTime = Date.now();
            
            console.log(`✅ Sucesso! Status: ${response.status}`);
            console.log(`⏱️  Tempo: ${endTime - startTime}ms`);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`📦 Resposta: ${JSON.stringify(data)}`);
            }
            
        } catch (error) {
            const endTime = Date.now();
            console.log(`❌ Erro após ${endTime - startTime}ms:`, error.message);
            console.log(`Tipo: ${error.name}`);
            
            // Detectar problemas específicos
            if (error.code) console.log(`Código: ${error.code}`);
            if (error.type) console.log(`Tipo: ${error.type}`);
        }
    }
}

// Teste também a verificação de status
async function testCheckEndpoint() {
    console.log('\n\n🔍 Testando endpoint /check/:id');
    
    try {
        const response = await fetch('https://grupossd.xyz/check/test-id-123', {
            timeout: 5000
        });
        console.log(`Status do check: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`Resposta: ${JSON.stringify(data)}`);
        }
    } catch (error) {
        console.log(`Erro no check: ${error.message}`);
    }
}

// Executar testes
testAPI().then(testCheckEndpoint).catch(console.error);