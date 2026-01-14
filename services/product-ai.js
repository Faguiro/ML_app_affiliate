// services/product-ai.js
import Groq from "groq-sdk";
import { config } from '../core/config.js';
import { log } from '../core/logger.js';

let groq = null;

// Função para remover promoções do texto
function stripPromo(text) {
    if (!text || typeof text !== 'string') return '';
    
    return String(text)
        // Remove blocos de preços
        .replace(/de:\s*R?\$?\s*[\d.,]+.*?\n/gi, '')
        .replace(/De:\s*R?\$?\s*[\d.,]+.*?\n/gi, '')
        .replace(/por:\s*R?\$?\s*[\d.,]+.*?\n/gi, '')
        .replace(/Por:\s*R?\$?\s*[\d.,]+.*?\n/gi, '')
        // Remove cupons
        .replace(/cupom:.*?\n/gi, '')
        .replace(/Cupom:.*?\n/gi, '')
        .replace(/código:.*?\n/gi, '')
        // Remove qualquer menção a preços com emojis
        .replace(/💸.*?\n/gi, '')
        .replace(/💰.*?\n/gi, '')
        .replace(/🔥.*?\n/gi, '')
        // Remove links
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/Comprar:.*?\n/gi, '')
        // Limpa múltiplas quebras de linha
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export class ProductDescriptionAI {
    static init() {
        if (!process.env.GROQ_API_KEY) {
            log.warn('GROQ_API_KEY não configurada. Desativando IA de descrição.');
            return false;
        }
        
        groq = new Groq({
            apiKey: process.env.GROQ_API_KEY
        });
        
        return true;
    }

    static async enhanceAffiliateMessage(productTitle, originalMetadata = {}, originalDescription = '') {
        try {
            // Sanitiza a descrição removendo promoções
            const cleanDescription = stripPromo(originalDescription);
            
            // Gera descrição com IA usando apenas dados limpos
            const aiDescription = await this.generateProductDescription(
                productTitle,
                cleanDescription
            );
            
            // Combina com metadados existentes
            return {
                ...originalMetadata,
                ai_description: aiDescription,
                enhanced: true
            };
            
        } catch (error) {
            log.error('Erro ao aprimorar mensagem:', error);
            return originalMetadata;
        }
    }

    static async generateProductDescription(productTitle, cleanDescription = '') {
        if (!groq) {
            log.warn('IA não inicializada. Retornando descrição padrão.');
            return this.getDefaultDescription(productTitle);
        }

        try {
            log.info(`Gerando descrição para: ${productTitle}`);
            
            // Construir prompt melhorado com a descrição limpa
            let userPrompt = `Título do produto: "${productTitle}"`;
            
            if (cleanDescription && cleanDescription.trim()) {
                userPrompt += `\n\nDescrição do produto (sem preços ou promoções):\n"${cleanDescription.substring(0, 800)}"\n\n`;
                userPrompt += `Com base nesta descrição, crie uma versão resumida e persuasiva (2-3 frases) destacando os benefícios principais.`;
            } else {
                userPrompt += `\n\nCrie uma descrição persuasiva e atrativa (2-3 frases) para este produto.`;
            }
            
            const completion = await groq.chat.completions.create({
                model: "groq/compound-mini",
                messages: [
                    {
                        role: "system",
                        content: `Você é um especialista em marketing digital e copywriting para e-commerce.
                        Sua missão é criar descrições persuasivas e atrativas para produtos.

                        🎯 OBJETIVO: Criar uma descrição curta e impactante que gere interesse no produto.

                        📝 DIRETRIZES CRÍTICAS:
                        - MÁXIMO 2-3 frases
                        - Linguagem informal e envolvente
                        - Destaque benefícios ou características principais
                        - Use emojis relevantes (máx 3-4)
                        - Não repita o título do produto
                        - NUNCA mencione preços, cupons ou promoções
                        - NUNCA mencione "compre agora" ou "clique aqui"
                        - Foque apenas nas características do produto
                        - Baseie-se nos detalhes da descrição limpa fornecida

                        ❌ ABSOLUTAMENTE PROIBIDO:
                        - Não mencione valores monetários
                        - Não mencione descontos ou promoções
                        - Não mencione cupons ou códigos
                        - Não inclua links
                        - Não use termos como "oferta", "promoção", "desconto"

                        📌 EXEMPLOS CORRETOS:
                        Título: "Fone Bluetooth com Cancelamento de Ruído"
                        Descrição: "🎧 Imersão sonora completa! Ideal para quem trabalha em ambientes barulhentos ou ama música sem interferências. A qualidade de áudio vai te surpreender! ✨"

                        Título: "Kit Ferramentas Profissional 150 Peças"
                        Descrição: "🔧 Para projetos DIY ou profissionais! Kit completo com tudo que você precisa para reparos e montagens. Durabilidade e precisão em cada peça. 💪"`
                    },
                    {
                        role: "user",
                        content: userPrompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 150,
                stream: false
            });

            const description = completion?.choices?.[0]?.message?.content?.trim();
            
            if (description) {
                log.info(`Descrição gerada: ${description.substring(0, 350)}`);
                return description;
            } else {
                return this.getDefaultDescription(productTitle);
            }

        } catch (error) {
            log.error('Erro ao gerar descrição com IA:', error);
            return this.getDefaultDescription(productTitle);
        }
    }

    static getDefaultDescription(productTitle) {
        // Fallback seguro - sem mencionar preços
        const defaults = [
            `✨ Produto incrível com ótimas características! Vale a pena conferir.`,
            `🛒 Recomendação especial! Este produto tem tudo para impressionar.`,
            `🔥 Achado interessante! Pode ser exatamente o que você precisa.`,
            `🎯 Dica valiosa! Merece uma olhada mais de perto pelas suas qualidades.`
        ];
        
        const randomIndex = Math.floor(Math.random() * defaults.length);
        return defaults[randomIndex];
    }
}