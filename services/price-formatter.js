// services/price-formatter.js
// Formatador de preços no padrão brasileiro

export class PriceFormatter {
    /**
     * Formata número para formato brasileiro: R$ 1.000,00
     * @param {number} value - Valor numérico
     * @returns {string} Preço formatado
     */
    static format(value) {
        if (value === null || value === undefined || !isFinite(value)) {
            return null;
        }

        // Converter para número se for string
        const number = typeof value === 'number' ? value : parseFloat(value);

        if (isNaN(number)) {
            return null;
        }

        // Formatar com separadores brasileiros
        const formatted = number.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        return `R$ ${formatted}`;
    }

    /**
     * Formata apenas o valor numérico (sem R$)
     */
    static formatValue(value) {
        if (value === null || value === undefined || !isFinite(value)) {
            return null;
        }

        const number = typeof value === 'number' ? value : parseFloat(value);

        if (isNaN(number)) {
            return null;
        }

        return number.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    /**
     * Exemplos de formatação:
     * 1234.56    → "R$ 1.234,56"
     * 999.9      → "R$ 999,90"
     * 1000000    → "R$ 1.000.000,00"
     * 49.99      → "R$ 49,99"
     */
}