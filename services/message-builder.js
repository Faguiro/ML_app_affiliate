// services/message-builder.js
import { PriceFormatter } from './price-formatter.js';
import { config } from '../core/config.js';

/**
 * Classe responsável por construir mensagens de afiliados
 * com lógica clara e previsível
 */
export class MessageBuilder {
    
    /**
     * Constrói a mensagem completa
     * @param {Object} normalizedData - Dados normalizados pelo DataNormalizer
     * @returns {string} Mensagem formatada
     */
    static build(normalizedData) {
        // ✅ LOG DE DEBUG
        console.log('🔍 [BUILDER DEBUG] normalizedData.cupom:', normalizedData.cupom);
        console.log('🔍 [BUILDER DEBUG] normalizedData completo (primeiros 300 chars):', JSON.stringify(normalizedData).substring(0, 300));

        const sections = [];

        // 1. TÍTULO (sempre presente)
        sections.push(this._buildTitle(normalizedData.title));

        // 2. DESCRIÇÃO (se disponível)
        if (normalizedData.description) {
            if (config.is_description){
            sections.push(this._buildDescription(normalizedData.description));
        }

        }

        // 3. PREÇO (se disponível)
        if (normalizedData.price.hasPrice) {
            sections.push(this._buildPrice(normalizedData.price));
        }

        // 4. CUPOM (se disponível)
        if (normalizedData.cupom) {
            console.log('✅ [BUILDER DEBUG] Adicionando cupom à mensagem:', normalizedData.cupom);
            sections.push(this._buildcupom(normalizedData.cupom));
        } else {
            console.log('⚠️ [BUILDER DEBUG] Cupom NÃO encontrado em normalizedData');
        }

        // 5. LINK DE COMPRA (sempre presente)
        sections.push(this._buildLink(normalizedData.affiliate_link));

        // 6. RODAPÉ (sempre presente)
        sections.push(this._buildFooter());

        const finalMessage = sections.join('\n\n').trim();
        
        // ✅ LOG DE DEBUG
        console.log('🔍 [BUILDER DEBUG] Mensagem final contém "Cupom"?', finalMessage.includes('Cupom'));
        console.log('🔍 [BUILDER DEBUG] Mensagem final (primeiros 500 chars):', finalMessage.substring(0, 500));

        return finalMessage;
    }

    /**
     * Constrói payload para envio no WhatsApp
     */
    static buildPayload(normalizedData) {
        const caption = this.build(normalizedData);

        // Se tem imagem, enviar com imagem
        if (normalizedData.image) {
            return {
                image: { url: normalizedData.image.url },
                caption: caption
            };
        }

        // Caso contrário, apenas texto
        return { text: caption };
    }

    // ==================== BUILDERS INTERNOS ====================

    static _buildTitle(title) {
        return `📦 ${title}`;
    }

    static _buildDescription(description) {
        return description;
    }

    static _buildPrice(priceData) {
        const lines = [];

        if (priceData.discount && priceData.original) {
            // Tem desconto - mostrar de/por
            lines.push(`💰 De: ${PriceFormatter.format(priceData.original)}`);
            lines.push(`🔥 Por: ${PriceFormatter.format(priceData.current)}`);
            lines.push(`🎯 ${priceData.discount}% OFF`);
        } else {
            // Apenas preço atual
            lines.push(`💰 Preço: ${PriceFormatter.format(priceData.current)}`);
        }

        return lines.join('\n');
    }

    static _buildcupom(cupom) {
        return `🎟️ Cupom: ${cupom}`;
    }

    static _buildLink(link) {
        return `🛒 Comprar agora:\n👉 ${link}`;
    }

    static _buildFooter() {

        let randon_footer = [
            `✅ Entrega garantida`,
            `🛡️ Compra segura`,            
        ]
        // implementar randon footer no futuro
        return `🛡️ Compra segura`;
    }

    /**
     * Variação: Mensagem compacta (útil para rate limiting)
     */
    static buildCompact(normalizedData) {
        const parts = [
            normalizedData.title,
            normalizedData.price.hasPrice ? 
                `💰 ${PriceFormatter.format(normalizedData.price.current)}` : '',
            normalizedData.cupom ? `🎟️ ${normalizedData.cupom}` : '',
            `🛒 ${normalizedData.affiliate_link}`
        ].filter(Boolean);

        return parts.join('\n');
    }

    /**
     * Variação: Mensagem rica (com emojis extras)
     */
    static buildRich(normalizedData) {
        const sections = [];

        // Título com destaque
        sections.push(`✨ ${normalizedData.title} ✨`);

        // Descrição
        if (normalizedData.description) {
            sections.push(`\n${normalizedData.description}`);
        }

        // Preço com animação
        if (normalizedData.price.hasPrice) {
            if (normalizedData.price.discount) {
                sections.push(
                    `\n🚨 OFERTA IMPERDÍVEL! 🚨`,
                    `💸 De: ${PriceFormatter.format(normalizedData.price.original)}`,
                    `🔥 Por: ${PriceFormatter.format(normalizedData.price.current)}`,
                    `🎁 Economize ${normalizedData.price.discount}%!`
                );
            } else {
                sections.push(`\n💰 Preço: ${PriceFormatter.format(normalizedData.price.current)}`);
            }
        }

        // Cupom destacado
        if (normalizedData.cupom) {
            sections.push(`\n🎟️ USE O CUPOM: ${normalizedData.cupom}`);
        }

        // Link
        sections.push(
            `\n🛒 COMPRE AGORA:`,
            `👉 ${normalizedData.affiliate_link}`,
            `\n✅ Entrega garantida | 🛡️ Compra segura`
        );

        return sections.join('\n');
    }
}