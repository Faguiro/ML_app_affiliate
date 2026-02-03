export class PriceParser {
    static parse(text = '') {
        if (!text) return {};
        
        const clean = text.replace(/\n+/g, ' ').toUpperCase();
        
        let price = null;
        let priceOriginal = null;
        let discount = null;
        let cupom = null;
        let payment = null;
        
        // CUPOM - prioridade baixa (já extraído do WhatsApp)
        const cupomMatch = clean.match(/CUPOM[:\s]*([A-Z0-9-_]+)/);
        if (cupomMatch) cupom = cupomMatch[1];
        
        // PIX / CARTÃO
        if (clean.includes('PIX')) payment = 'pix';
        if (clean.includes('CART')) payment = 'card';
        
        // DE / POR - prioridade baixa (já extraído do WhatsApp)
        const dePor = clean.match(/DE\s*R?\$?\s*([\d.,]+).*?POR\s*R?\$?\s*([\d.,]+)/);
        if (dePor) {
            priceOriginal = `R$ ${dePor[1]}`;
            price = `R$ ${dePor[2]}`;
        }
        
        // DESCONTO %
        const discountMatch = clean.match(/(\d{1,2})\s*%/);
        if (discountMatch) discount = discountMatch[1];
        
        // FALLBACK: primeiro preço
        if (!price) {
            const priceMatch = clean.match(/R?\$?\s*([\d.,]+)/);
            if (priceMatch) price = `R$ ${priceMatch[1]}`;
        }
        
        return {
            price,
            price_original: priceOriginal,
            discount_percent: discount,
            cupom,
            payment_method: payment,
            raw_price_text: text
        };
    }
}