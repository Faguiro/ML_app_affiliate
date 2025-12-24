// services/affiliate.js
import { config } from '../core/config.js';
import { log } from '../core/logger.js';
import { ProductDescriptionAI } from './product-ai.js';

export class AffiliateService {
    static async generateAffiliateLink(productUrl) {
        const maxRetries = config.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log.info(`Tentativa ${attempt}/${maxRetries} para: ${productUrl}`);

                // Etapa 1: Iniciar processamento
                const processId = await this.startProcessing(productUrl);
                if (!processId) {
                    throw new Error('Falha ao iniciar processamento');
                }

                // Etapa 2: Aguardar conclusão
                const result = await this.waitForCompletion(processId);

                // DEBUG: Verifique o que está vindo
                console.log('📦 Resultado do waitForCompletion:', JSON.stringify(result, null, 2));

                if (result && result.affiliate_link) {
                    // Inicializar IA se disponível
                    const aiEnabled = ProductDescriptionAI.init();

                    let metadata = {
                        product_title: result.product_title,
                        price: result.price || '',
                        suggested_text: result.suggested_text || '',
                        product_image: result.product_image || null
                    };

                    // Se IA disponível, aprimora a descrição
                    if (aiEnabled && result.product_title) {
                        try {
                            const enhancedMetadata = await ProductDescriptionAI.enhanceAffiliateMessage(
                                result.product_title,
                                metadata
                            );
                            metadata = enhancedMetadata;
                        } catch (error) {
                            log.warn('Não foi possível aprimorar com IA:', error.message);
                        }
                    }

                    return {
                        success: true,
                        affiliate_link: result.affiliate_link,
                        metadata: metadata
                    };
                }

            } catch (error) {
                log.error(`Tentativa ${attempt} falhou:`, error.message);

                if (attempt === maxRetries) {
                    return {
                        success: false,
                        error: error.message
                    };
                }

                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        return { success: false, error: 'Máximo de tentativas atingido' };
    }

    static async startProcessing(productUrl) {
        try {
            const response = await fetch(`${config.apiUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_url: productUrl }),
                signal: AbortSignal.timeout(config.apiTimeout)
            });

            const data = await response.json();
            return data.id;

        } catch (error) {
            log.error('Erro ao iniciar processamento', error);
            return null;
        }
    }

    static async waitForCompletion(processId, maxChecks = 30) {
        for (let check = 1; check <= maxChecks; check++) {
            try {
                const response = await fetch(`${config.apiUrl}/check/${processId}`, {
                    signal: AbortSignal.timeout(35000)
                });

                const apiResponse = await response.json();
                console.log(`Check ${check}:`, JSON.stringify(apiResponse));

                if (apiResponse.status === 'completed') {
                    // Dados podem estar em apiResponse.data ou diretamente em apiResponse
                    const data = apiResponse.data || apiResponse;

                    const affiliateLink = data.affiliate_link ||
                        data.link ||
                        data.Link;

                    if (affiliateLink) {
                        console.log(`✅ Link encontrado: ${affiliateLink}`);

                        // Retorna objeto estruturado corretamente
                        return {
                            affiliate_link: affiliateLink,
                            product_title: data.product_title || '',
                            price: data.price || '',
                            suggested_text: data.suggested_text || '',
                            product_image: data.product_image || null
                        };
                    }
                }

                if (apiResponse.status === 'failed') {
                    throw new Error(apiResponse.message || 'Processamento falhou');
                }

                await new Promise(resolve => setTimeout(resolve, 50000));

            } catch (error) {
                console.error(`Check ${check} falhou:`, error.message);
                if (check === maxChecks) throw error;
            }
        }
        throw new Error(`Timeout após ${maxChecks} verificações`);
    }

}