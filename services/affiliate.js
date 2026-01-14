// services/affiliate.js - REFATORADO COM NORMALIZAÇÃO DE RESPOSTAS
import { config } from '../core/config.js';
import { log } from '../core/logger.js';
import { ProductDescriptionAI } from './product-ai.js';

/**
 * Estados possíveis da API (sincronizado com Python)
 */
const ProcessStatus = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED_TEMPORARY: 'failed_temporary',
    FAILED_PERMANENT: 'failed_permanent',
    FAILED_AUTH: 'failed_auth',
    FAILED_CAPTCHA: 'failed_captcha',
    FAILED_NETWORK: 'failed_network'
};

/**
 * Tipos de erro (sincronizado com Python)
 */
const ErrorType = {
    AUTH_EXPIRED: 'auth_expired',
    CAPTCHA_REQUIRED: 'captcha_required',
    NETWORK_TIMEOUT: 'network_timeout',
    INVALID_URL: 'invalid_url',
    RATE_LIMIT: 'rate_limit',
    UNKNOWN: 'unknown'
};

export class AffiliateService {
    /**
     * Gera link de afiliado com lógica inteligente de retry
     */
    static async generateAffiliateLink(link) {
        const productUrl = typeof link === 'string' ? link : link.original_url;
        const maxRetries = config.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log.info(`Tentativa ${attempt}/${maxRetries}`);

                // Etapa 1: Iniciar processamento
                const processId = await this.startProcessing(productUrl);
                if (!processId) {
                    throw new Error('Falha ao iniciar processamento');
                }
                console.log('📦 Process ID recebido:', processId);
                
                // Pausa antes de verificar conclusão
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Etapa 2: Aguardar conclusão
                const apiResult = await this.waitForCompletion(processId);
                console.log('📦 Resultado da API:', JSON.stringify(apiResult, null, 2));

                // ========== VERIFICAR STATUS DA RESPOSTA ==========
                const status = apiResult.status;
                const retryAllowed = apiResult.retry_allowed ?? true; // Default true se não especificado

                // ========== TRATAR ERROS PERMANENTES ==========
                if (status === ProcessStatus.FAILED_AUTH) {
                    log.error('❌ AUTENTICAÇÃO EXPIRADA - Não tentar novamente');
                    log.error('Mensagem:', apiResult.error?.user_message);
                    log.error('Ação necessária:', apiResult.requires_action);
                    
                    return {
                        success: false,
                        error: apiResult.error?.user_message || 'Sessão expirada',
                        status: 'failed_auth',
                        requires_action: apiResult.requires_action,
                        retry_allowed: false
                    };
                }

                if (status === ProcessStatus.FAILED_CAPTCHA) {
                    log.error('❌ CAPTCHA DETECTADO - Intervenção manual necessária');
                    log.error('Mensagem:', apiResult.error?.user_message);
                    
                    return {
                        success: false,
                        error: apiResult.error?.user_message || 'CAPTCHA detectado',
                        status: 'failed_captcha',
                        requires_action: 'manual_intervention',
                        retry_allowed: false
                    };
                }

                if (status === ProcessStatus.FAILED_PERMANENT) {
                    log.error('❌ ERRO PERMANENTE - Não tentar novamente');
                    log.error('Tipo:', apiResult.error?.type);
                    log.error('Mensagem:', apiResult.error?.user_message);
                    
                    return {
                        success: false,
                        error: apiResult.error?.user_message || 'Erro permanente',
                        status: 'failed_permanent',
                        error_type: apiResult.error?.type,
                        retry_allowed: false
                    };
                }

                // ========== VERIFICAR SE PODE TENTAR NOVAMENTE ==========
                if (!retryAllowed) {
                    log.error('❌ Erro sem permissão para retry');
                    return {
                        success: false,
                        error: apiResult.error?.user_message || 'Processamento falhou',
                        status: status,
                        retry_allowed: false
                    };
                }

                // ========== PROCESSAR SUCESSO ==========
                if (apiResult.success && apiResult.data?.affiliate_link) {
                    log.info('✅ Link de afiliado gerado com sucesso!');
                    
                    // Extrair dados do WhatsApp
                    const whatsappData = this.extractWhatsAppData(link.copy_text);

                    // Montar metadata
                    let metadata = {
                        // Dados da API
                        product_title: apiResult.data.product_title || '',
                        product_price: apiResult.data.product_price || null,
                        price_original: apiResult.data.price_original || null,
                        product_image: apiResult.data.product_image || null,
                        
                        // Dados do WhatsApp (sobrescreve se disponível)
                        ...whatsappData,
                        
                        // Link de afiliado
                        affiliate_link: apiResult.data.affiliate_link
                    };

                    // Tentar melhorar com IA
                    if (ProductDescriptionAI.init()) {
                        try {
                            const aiDescription = await ProductDescriptionAI.generateProductDescription(
                                metadata.product_title,
                                whatsappData.description || ''
                            );
                            
                            if (aiDescription) {
                                metadata.ai_description = aiDescription;
                            }
                        } catch (error) {
                            log.warn('Não foi possível aprimorar com IA:', error.message);
                        }
                    }

                    return {
                        success: true,
                        affiliate_link: apiResult.data.affiliate_link,
                        metadata: metadata,
                        status: 'completed'
                    };
                }

                // ========== ERRO TEMPORÁRIO - PODE TENTAR NOVAMENTE ==========
                log.warn(`⚠️ Tentativa ${attempt} falhou (temporário)`);

            } catch (error) {
                log.error(`Tentativa ${attempt} falhou com exceção:`, error.message);

                // Se chegou ao máximo de tentativas, retornar falha
                if (attempt === maxRetries) {
                    return {
                        success: false,
                        error: error.message,
                        status: 'failed_temporary',
                        retry_allowed: false
                    };
                }

                // Backoff exponencial
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }

        return { 
            success: false, 
            error: 'Máximo de tentativas atingido',
            status: 'failed_temporary',
            retry_allowed: false
        };
    }

    /**
     * Extrai dados relevantes do WhatsApp
     */
    static extractWhatsAppData(copyTextStr) {
        try {
            if (!copyTextStr) return {};

            const data = JSON.parse(copyTextStr);
            const extracted = {};

            // Título
            if (data.title?.trim() && data.title !== "Produto Shopee") {
                extracted.title = data.title.trim();
            } else if (data.text) {
                const firstLine = data.text.split('\n')[0]?.trim();
                if (firstLine && firstLine.length > 10 && !firstLine.includes('http')) {
                    extracted.title = firstLine;
                }
            }

            // Descrição
            if (data.description?.trim()) {
                extracted.description = data.description.trim();
            }

            // Preços
            if (data.text) {
                const priceData = this._extractPricesFromText(data.text);
                if (priceData.price_from) extracted.price_from = priceData.price_from;
                if (priceData.price_to) extracted.price_to = priceData.price_to;
                if (priceData.coupon) extracted.coupon = priceData.coupon;
            }

            // Imagem
            if (data.jpegThumbnail && this._isValidBase64(data.jpegThumbnail)) {
                extracted.image = `data:image/jpeg;base64,${data.jpegThumbnail}`;
                console.log('✅ Imagem WhatsApp convertida para base64');
            }

            return extracted;

        } catch (error) {
            console.error('Erro ao extrair dados do WhatsApp:', error);
            return {};
        }
    }

    /**
     * Extrai preços e cupom do texto do WhatsApp
     */
    static _extractPricesFromText(text) {
        if (!text || typeof text !== 'string') return {};

        const result = {};

        try {
            const normalized = text
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .toLowerCase();

            // Padrões para preço DE
            const dePatterns = [
                /de\s*[:]?\s*r?\$?\s*([\d.,]+)/i,
                /💰\s*de\s*[:]?\s*r?\$?\s*([\d.,]+)/i
            ];

            // Padrões para preço POR
            const porPatterns = [
                /por\s*[:]?\s*r?\$?\s*([\d.,]+)/i,
                /🔥\s*por\s*[:]?\s*r?\$?\s*([\d.,]+)/i,
                /apenas\s*[:]?\s*r?\$?\s*([\d.,]+)/i
            ];

            // Padrões para cupom
            const couponPatterns = [
                /cupom:\s*[:]?\s*([a-z0-9\-_]+)/i,
                /código\s*[:]?\s*([a-z0-9\-_]+)/i,
                /([A-Z0-9\-_]{4,})\s*\(cupom\)/i
            ];

            // Procurar preços
            for (const pattern of dePatterns) {
                const match = normalized.match(pattern);
                if (match?.[1]) {
                    result.price_from = `R$ ${match[1]}`;
                    break;
                }
            }

            for (const pattern of porPatterns) {
                const match = normalized.match(pattern);
                if (match?.[1]) {
                    result.price_to = `R$ ${match[1]}`;
                    break;
                }
            }

            // Procurar cupom
            for (const pattern of couponPatterns) {
                const match = normalized.match(pattern);
                if (match?.[1]) {
                    result.coupon = match[1].toUpperCase();
                    break;
                }
            }

        } catch (error) {
            console.error('Erro ao extrair preços:', error);
        }

        return result;
    }

    /**
     * Valida se uma string é base64 válida
     */
    static _isValidBase64(str) {
        if (!str || typeof str !== 'string') return false;
        
        return (
            str.startsWith('/9j/') ||
            str.startsWith('iVBORw') ||
            (str.length > 100 && !str.includes(',') && !str.includes(' '))
        );
    }

    // ================ Métodos de integração com API externa =================
    
    /**
     * Inicia o processamento na API
     */
    static async startProcessing(productUrl) {
        try {
            console.log(`Iniciando processamento em: ${config.apiUrl}/generate`);
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

    /**
     * Aguarda conclusão do processamento com interpretação inteligente de status
     */
    static async waitForCompletion(processId, maxChecks = 10) {
        for (let check = 1; check <= maxChecks; check++) {
            try {
                const response = await fetch(`${config.apiUrl}/check/${processId}`, {
                    signal: AbortSignal.timeout(35000)
                });

                const apiResponse = await response.json();
                console.log(`Check ${check}:`, JSON.stringify(apiResponse, null, 2));
                
                // ========== INTERPRETAR STATUS ==========
                const status = apiResponse.status;
                
                // Status finais (não continuar checking)
                const finalStatuses = [
                    ProcessStatus.COMPLETED,
                    ProcessStatus.FAILED_AUTH,
                    ProcessStatus.FAILED_CAPTCHA,
                    ProcessStatus.FAILED_PERMANENT,
                ];

                // Se status final OU retry_allowed = false, retornar imediatamente
                if (finalStatuses.includes(status) || apiResponse.retry_allowed === false) {
                    console.log(`✅ Status final detectado: ${status}`);
                    return apiResponse;
                }

                // Se ainda está processando, continuar
                if (status === ProcessStatus.PROCESSING || status === ProcessStatus.PENDING ) {
                    console.log(`⏳ Ainda processando... (${status})`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }

                // Verificação de sucesso explícito (fallback para APIs antigas)
                if (apiResponse.success === true && apiResponse.data?.affiliate_link) {
                    console.log(`✅ Link encontrado via success flag`);
                    return apiResponse;
                }

                // Se falhou explicitamente
                if (apiResponse.success === false || status === "failed") {
                    console.log(`❌ Falha detectada via success flag`);
                    return apiResponse;
                }

                // Status desconhecido - continuar tentando
                console.log(`⚠️ Status desconhecido: ${status}, continuando...`);
                await new Promise(resolve => setTimeout(resolve, 5000));

            } catch (error) {
                console.error(`Check ${check} falhou:`, error.message);
                
                // Se é o último check, lançar erro
                if (check === maxChecks) {
                    throw error;
                }
                
                // Caso contrário, tentar novamente
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        // Timeout
        throw new Error(`Timeout após ${maxChecks} verificações`);
    }
}

// Exportar constantes para uso em outros módulos
export { ProcessStatus, ErrorType };