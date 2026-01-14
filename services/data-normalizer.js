// services/data-normalizer.js

/**
 * Classe responsável por normalizar dados de múltiplas fontes
 * Prioridade: API > WhatsApp > Fallback
 */
export class DataNormalizer {
    
    /**
     * Normaliza todos os dados do produto
     * @param {Object} apiMetadata - Dados da API de afiliados
     * @param {Object} whatsappCopy - Dados extraídos do WhatsApp
     * @returns {Object} Dados normalizados
     */
    static normalize(apiMetadata = {}, whatsappCopy = {}) {
        // Garantir que temos objetos válidos
        const api = apiMetadata || {};
        const wa = whatsappCopy || {};

        try {
            return {
                title: this.normalizeTitle(api, wa),
                price: this.normalizePrice(api, wa),
                image: this.normalizeImage(api, wa),
                coupon: this.normalizeCoupon(api, wa),
                description: this.normalizeDescription(api, wa),
                affiliate_link: api.affiliate_link || wa.url || ''
            };
        } catch (error) {
            console.error('❌ Erro na normalização de dados:', error);
            // Retornar objeto mínimo válido
            return {
                title: 'Produto em destaque',
                price: { current: null, original: null, discount: null, hasPrice: false },
                image: null,
                coupon: null,
                description: '',
                affiliate_link: api.affiliate_link || wa.url || ''
            };
        }
    }

    /**
     * Normaliza o título do produto
     */
    static normalizeTitle(api, wa) {
        try {
            // Prioridade: API > WhatsApp title > Primeira linha do texto
            if (api?.product_title?.trim()) {
                return api.product_title.trim();
            }

            if (wa?.title?.trim() && wa.title !== "Produto Shopee") {
                return wa.title.trim();
            }

            // Tentar extrair da primeira linha do texto
            if (wa?.text) {
                const firstLine = wa.text.split('\n')[0]?.trim();
                if (firstLine && firstLine.length > 10 && !firstLine.includes('http')) {
                    return firstLine;
                }
            }

            return 'Produto em destaque';
        } catch (error) {
            console.error('Erro ao normalizar título:', error);
            return 'Produto em destaque';
        }
    }

    /**
     * Normaliza preços e calcula desconto
     */
    static normalizePrice(api, wa) {
        const result = {
            current: null,
            original: null,
            discount: null,
            hasPrice: false
        };

        try {
            // Tentar obter preço atual
            result.current = this._extractPrice(
                api?.product_price ?? api?.price_current ?? api?.price ?? wa?.price_to
            );

            // Tentar obter preço original
            result.original = this._extractPrice(
                api?.price_original ?? wa?.price_from
            );

            // Validar e calcular desconto
            if (result.current > 0) {
                result.hasPrice = true;

                if (result.original > result.current) {
                    result.discount = Math.round(
                        ((result.original - result.current) / result.original) * 100
                    );
                }
            }

            return result;
        } catch (error) {
            console.error('Erro ao normalizar preço:', error);
            return result;
        }
    }

    /**
     * Normaliza a imagem do produto
     */
    static normalizeImage(api, wa) {
        try {
            // Prioridade: WhatsApp base64 > API URL > API base64
            
            // 1. Imagem do WhatsApp (base64)
            if (wa?.image?.startsWith('data:image')) {
                return {
                    url: wa.image,
                    source: 'whatsapp'
                };
            }

            // 2. Imagem da API (URL)
            if (api?.product_image?.startsWith('http')) {
                return {
                    url: api.product_image,
                    source: 'api'
                };
            }

            // 3. Imagem da API (base64)
            if (api?.product_image?.startsWith('data:image')) {
                return {
                    url: api.product_image,
                    source: 'api_base64'
                };
            }

            return null;
        } catch (error) {
            console.error('Erro ao normalizar imagem:', error);
            return null;
        }
    }

    /**
     * Normaliza cupom de desconto
     */
    static normalizeCoupon(api, wa) {
        try {
            const coupon = api?.coupon ?? wa?.coupon;
            return coupon?.trim() ? coupon.trim().toUpperCase() : null;
        } catch (error) {
            console.error('Erro ao normalizar cupom:', error);
            return null;
        }
    }

    /**
     * Normaliza descrição do produto
     */
    static normalizeDescription(api, wa) {
        try {
            // Prioridade: API AI description > WhatsApp description > Texto do WhatsApp
            if (api?.ai_description?.trim()) {
                return api.ai_description.trim();
            }

            if (api?.description?.trim()) {
                return api.description.trim();
            }

            if (wa?.description?.trim()) {
                return wa.description.trim();
            }

            return '';
        } catch (error) {
            console.error('Erro ao normalizar descrição:', error);
            return '';
        }
    }

    /**
     * Extrai valor numérico de preço de várias fontes
     * @private
     */
    static _extractPrice(value) {
        try {
            if (value === null || value === undefined) {
                return null;
            }

            // Já é número
            if (typeof value === 'number' && isFinite(value)) {
                return value;
            }

            // É string - tentar converter
            if (typeof value === 'string') {
                const cleaned = value
                    .replace(/R\$\s?/gi, '')
                    .replace(/\./g, '')
                    .replace(',', '.')
                    .trim();

                const num = parseFloat(cleaned);
                return isFinite(num) && num > 0 ? num : null;
            }

            return null;
        } catch (error) {
            console.error('Erro ao extrair preço:', error, value);
            return null;
        }
    }
}