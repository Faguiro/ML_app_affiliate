// services/product-ai.js
import Groq from "groq-sdk";
import { config } from '../core/config.js';
import { log } from '../core/logger.js';

let groq = null;

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

    static async generateProductDescription(productTitle, productUrl = '') {
        if (!groq) {
            log.warn('IA não inicializada. Retornando descrição padrão.');
            return this.getDefaultDescription(productTitle);
        }

        try {
            log.info(`Gerando descrição para: ${productTitle}`);
            
            const completion = await groq.chat.completions.create({
                model: "groq/compound-mini",  // Modelo rápido e barato
                messages: [
                    {
                        role: "system",
                        content: `Você é um especialista em marketing digital e copywriting para e-commerce. 
                        Sua missão é criar descrições persuasivas e atrativas para produtos.

                        🎯 OBJETIVO: Criar uma descrição curta e impactante que gere interesse no produto.

                        📝 DIRETRIZES:
                        - MÁXIMO 2 frases
                        - Linguagem informal e envolvente
                        - Destaque benefícios ou características principais
                        - Use emojis relevantes (máx 3-4)
                        - Não repita o título do produto
                        - mencionar preço ou promoções, se aplicável
                        - mencionar peco original riscado, se aplicável
                        - mencionar desconto, se aplicável
                        - Foque em despertar curiosidade

                        🎨 TONS POSSÍVEIS:
                        1. Entusiasmado: "Perfeito para..." 
                        2. Prático: "Ideal para quem precisa de..."
                        3. Exclusivo: "Essa é a escolha dos especialistas em..."
                        4. Urgente: "Não perca essa oportunidade única de..."

                        ❌ NÃO FAÇA:
                        - Não inclua o link (já será fornecido separadamente)
                        - Não repita "compre agora" ou "clique aqui"
                        - Não faça spam ou pareça muito comercial
                        - Não mencione marcas específicas a menos que estejam no título

                        📌 EXEMPLOS:
                        Título: "Fone Bluetooth com Cancelamento de Ruído"
                        Descrição: "🎧 Imersão sonora completa! Ideal para quem trabalha em ambientes barulhentos ou ama música sem interferências. A qualidade de áudio vai te surpreender! ✨"

                        Título: "Kit Ferramentas Profissional 150 Peças"
                        Descrição: "🔧 Para projetos DIY ou profissionais! Kit completo com tudo que você precisa para reparos e montagens. Durabilidade e precisão em cada peça. 💪"

                        Agora crie uma descrição para o produto abaixo:`
                    },
                    {
                        role: "user",
                        content: `Título do produto: "${productTitle}"
                        ${productUrl ? `URL do produto: ${productUrl}` : ''}

                        Crie uma descrição persuasiva e atrativa (2-3 frases) para este produto.`
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
        // Fallback se a IA falhar
        const defaults = [
            `✨ Produto incrível encontrado pelos membros do grupo! Vale muito a pena conferir.`,
            `🛒 Recomendação especial do grupo! Este produto chamou muita atenção.`,
            `🔥 Achado interessante! Pode ser exatamente o que você está procurando.`,
            `🎯 Dica valiosa do grupo! Merece uma olhada mais de perto.`
        ];
        
        const randomIndex = Math.floor(Math.random() * defaults.length);
        return defaults[randomIndex];
    }

    // static async enhanceAffiliateMessage(productTitle, originalMetadata = {}) {
    //     try {
    //         // Gera descrição com IA
    //         const aiDescription = await this.generateProductDescription(productTitle);
            
    //         // Combina com metadados existentes
    //         return {
    //             ...originalMetadata,
    //             ai_description: aiDescription,
    //             enhanced: true
    //         };
            
    //     } catch (error) {
    //         log.error('Erro ao aprimorar mensagem:', error);
    //         return originalMetadata;
    //     }
    // }


     static async enhanceAffiliateMessage(productTitle, originalMetadata = {}, originalDescription = '') {
        try {
            // Gera descrição com IA, passando a descrição original como contexto
            const aiDescription = await this.generateProductDescription(
                productTitle, 
                originalDescription
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

    static async generateProductDescription(productTitle, originalDescription = '') {
        if (!groq) {
            log.warn('IA não inicializada. Retornando descrição padrão.');
            return this.getDefaultDescription(productTitle);
        }

        try {
            log.info(`Gerando descrição para: ${productTitle}`);
            
            // Construir prompt melhorado com a descrição original
            let userPrompt = `Título do produto: "${productTitle}"`;
            
            if (originalDescription && originalDescription.trim()) {
                userPrompt += `\n\nDescrição completa do produto:\n"${originalDescription.substring(0, 1000)}"\n\n`;
                userPrompt += `Com base nesta descrição completa, crie uma versão resumida e persuasiva (2-3 frases) destacando os benefícios principais.`;
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

                        📝 DIRETRIZES:
                        - MÁXIMO 2-3 frases
                        - Linguagem informal e envolvente
                        - Destaque benefícios ou características principais
                        - Use emojis relevantes (máx 3-4)
                        - Não repita o título do produto
                        - Se houver informação de preço na descrição original, mencione-o de forma atrativa
                        - Foque em despertar curiosidade
                        - Baseie-se nos detalhes da descrição original quando disponível

                        ❌ NÃO FAÇA:
                        - Não inclua o link (já será fornecido separadamente)
                        - Não repita "compre agora" ou "clique aqui"
                        - Não faça spam ou pareça muito comercial`
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
}