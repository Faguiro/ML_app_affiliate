// test-price-format.js
// Testa formatação de preços no padrão brasileiro

import { PriceFormatter } from './services/price-formatter.js';
import { DataNormalizer } from './services/data-normalizer.js';
import { MessageBuilder } from './services/message-builder.js';

console.log('💰 TESTANDO FORMATAÇÃO DE PREÇOS BRASILEIROS\n');

// ==========================================
// TESTE 1: Formatação Básica
// ==========================================
console.log('========== TESTE 1: Formatação Básica ==========\n');

const testCases = [
    { input: 1234.56, expected: 'R$ 1.234,56' },
    { input: 999.90, expected: 'R$ 999,90' },
    { input: 1000000, expected: 'R$ 1.000.000,00' },
    { input: 49.99, expected: 'R$ 49,99' },
    { input: 0.50, expected: 'R$ 0,50' },
    { input: 10, expected: 'R$ 10,00' },
    { input: 4198, expected: 'R$ 4.198,00' },
    { input: 7.209, expected: 'R$ 7,21' }  // Arredondamento
];

for (const test of testCases) {
    const result = PriceFormatter.format(test.input);
    const passed = result === test.expected;
    console.log(`${passed ? '✅' : '❌'} ${test.input} → ${result} (esperado: ${test.expected})`);
}

// ==========================================
// TESTE 2: Casos Especiais
// ==========================================
console.log('\n========== TESTE 2: Casos Especiais ==========\n');

const specialCases = [
    { input: null, expected: null },
    { input: undefined, expected: null },
    { input: NaN, expected: null },
    { input: Infinity, expected: null },
    { input: 'abc', expected: null }
];

for (const test of specialCases) {
    const result = PriceFormatter.format(test.input);
    const passed = result === test.expected;
    console.log(`${passed ? '✅' : '❌'} ${test.input} → ${result} (esperado: ${test.expected})`);
}

// ==========================================
// TESTE 3: Integração com DataNormalizer
// ==========================================
console.log('\n========== TESTE 3: Integração DataNormalizer ==========\n');

const apiData = {
    product_title: "iPhone 15",
    product_price: 4198,
    price_original: 7209,
    affiliate_link: "https://test.com"
};

const normalized = DataNormalizer.normalize(apiData, {});
console.log('Preço normalizado:', normalized.price);

// ==========================================
// TESTE 4: Mensagem Completa
// ==========================================
console.log('\n========== TESTE 4: Mensagem Completa ==========\n');

const message = MessageBuilder.build(normalized);
console.log('Mensagem gerada:');
console.log('---');
console.log(message);
console.log('---');

// ==========================================
// TESTE 5: Verificar Formato na Mensagem
// ==========================================
console.log('\n========== TESTE 5: Verificação de Formato ==========\n');

const hasCorrectFormat = message.includes('R$ 4.198,00') && message.includes('R$ 7.209,00');
console.log(`${hasCorrectFormat ? '✅' : '❌'} Formato brasileiro correto na mensagem`);

if (message.includes('R$ 4198')) {
    console.log('❌ ERRO: Formato americano detectado (sem separador de milhar)');
}

if (message.includes('R$ 4,198.00')) {
    console.log('❌ ERRO: Formato americano detectado (ponto e vírgula invertidos)');
}

// ==========================================
// TESTE 6: Variações de Mensagem
// ==========================================
console.log('\n========== TESTE 6: Variações ==========\n');

console.log('COMPACTA:');
console.log('---');
console.log(MessageBuilder.buildCompact(normalized));
console.log('---');

console.log('\nRICA:');
console.log('---');
console.log(MessageBuilder.buildRich(normalized));
console.log('---');

// ==========================================
// TESTE 7: Diferentes Valores
// ==========================================
console.log('\n========== TESTE 7: Diferentes Cenários ==========\n');

const scenarios = [
    {
        name: 'Produto barato',
        data: { product_price: 29.90, price_original: 59.90, affiliate_link: 'test' }
    },
    {
        name: 'Produto caro',
        data: { product_price: 15999, price_original: 19999, affiliate_link: 'test' }
    },
    {
        name: 'Sem desconto',
        data: { product_price: 199.90, affiliate_link: 'test' }
    },
    {
        name: 'Centavos específicos',
        data: { product_price: 1234.56, price_original: 2000.99, affiliate_link: 'test' }
    }
];

for (const scenario of scenarios) {
    console.log(`\n📦 ${scenario.name}:`);
    const norm = DataNormalizer.normalize(scenario.data, {});
    const msg = MessageBuilder.build(norm);
    
    // Extrair linhas de preço
    const priceLines = msg.split('\n').filter(line => line.includes('R$'));
    priceLines.forEach(line => console.log(`   ${line}`));
}

console.log('\n✅ Testes de formatação concluídos!');