// services/affiliate.js
import { config } from '../core/config.js';
import { log } from '../core/logger.js';
import { ProductDescriptionAI } from './product-ai.js';

export class AffiliateService {
    static async generateAffiliateLink(link) {
        const productUrl = typeof link === 'string' ? link : link.original_url;
        const maxRetries = config.maxRetries;

        console.log(`Conteudo de link na função: \n${JSON.stringify(link, null, 2)}\n`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log.info(`Tentativa ${attempt}/${maxRetries} para: ${productUrl}`);

                // Etapa 1: Iniciar processamento
                const processId = await this.startProcessing(productUrl);
                if (!processId) {
                    throw new Error('Falha ao iniciar processamento');
                }
                console.log('📦 Process ID recebido:', processId);
                // pequena pausa antes de aguardar conclusão
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Etapa 2: Aguardar conclusão
                const result = await this.waitForCompletion(processId);

                // DEBUG: Verifique o que está vindo
                console.log('📦 Resultado do waitForCompletion:', JSON.stringify(result, null, 2));

                if (result && result.affiliate_link) {
                    // Extrair dados do copy_text se a API não forneceu dados completos
                    const extractedData = this.extractDataFromCopyText(link.copy_text);
                    
                    // Inicializar IA se disponível
                    const aiEnabled = ProductDescriptionAI.init();

                    let metadata = {
                        product_title: result.product_title || extractedData.title || '',
                        price: extractedData.price || result.price_current || '',
                        price_original: extractedData.price_original || result.price_original || '',
                        discount_percent: extractedData.discount_percent || result.discount_percent || '',
                        product_image: extractedData.image || result.product_image || null,
                        description: extractedData.description || ''
                    };

                    // Se IA disponível, aprimora a descrição usando os dados extraídos
                    if (aiEnabled && (metadata.product_title || extractedData.description)) {
                        try {
                            const enhancedMetadata = await ProductDescriptionAI.enhanceAffiliateMessage(
                                metadata.product_title,
                                metadata,
                                extractedData.description // Passar descrição completa para a IA
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

    // Novo método para extrair dados do copy_text
    static extractDataFromCopyText(copyText) {
        try {
            if (!copyText) return {};
            
            const data = JSON.parse(copyText);
            const extracted = {};
            
            // Extrair título
            if (data.title && data.title != "Produto Shopee") {
                extracted.title = data.title;
            } else{
                extracted.title = data.description?.split('-')[0] || '';
            }
            
            // Extrair descrição
            if (data.description) {
                extracted.description = data.description;
            }
            
            // Extrair preço do texto da mensagem
            if (data.text) {
                const priceMatch = data.text.match(/\*💸Por 🔥: R\$\s*([\d,.-]+(?:\s*-\s*R\$\s*[\d,.]+)?)\*/);
                if (priceMatch) {
                    extracted.price = `R$ ${priceMatch[1]}`;
                }
            }
            
            // Extrair imagem em base64
            if (data.jpegThumbnail) {
                extracted.image = `data:image/jpeg;base64,${data.jpegThumbnail}`;
            }
            
            console.log('📋 Dados extraídos do copy_text:', extracted);
            return extracted;
            
        } catch (error) {
            console.error('Erro ao extrair dados do copy_text:', error);
            return {};
        }
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
                        console.log('📦 Dados retornados:', JSON.stringify(data, null, 2));
                        return {
                            affiliate_link: affiliateLink,
                            product_title: data.product_title || '',
                            price: data.price || '',
                            // suggested_text: data.suggested_text || '',
                            product_image: data.product_image || null,
                            price_current: data.price_current || null,
                            price_original: data.price_original || null,
                            discount_percent: data.discount_percent || null,
                        };
                    }
                }

                if (apiResponse.status === 'failed' || apiResponse.status === 'error') {
                    throw new Error(apiResponse.message || 'Processamento falhou');                    
                }

                await new Promise(resolve => setTimeout(resolve, 50000));

            } catch (error) { 
                console.error(`Check ${check} falhou:`, error.message);
                if (check === maxChecks) throw error;
                throw error;
            }
        }
        throw new Error(`Timeout após ${maxChecks} verificações`);
    }

}