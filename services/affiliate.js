// services/affiliate.service.js

import { config } from "../core/config.js";
import { log } from "../core/logger.js";
import { ProductDescriptionAI } from "./product-ai.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AffiliateService {
  // =========================
  // API calls
  // =========================
  static async generate(productUrl) {
    const res = await fetch(`${config.apiUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_url: productUrl }),
    });

    if (!res.ok) throw new Error(`Generate falhou: ${res.status}`);

    const data = await res.json();

    const processId = data?.id || data?.process_id;

    if (!processId) throw new Error("process_id não retornado");

    return processId;
  }

  static async check(processId) {
    const res = await fetch(`${config.apiUrl}/check/${processId}`);
    if (!res.ok) throw new Error(`Check falhou: ${res.status}`);
    return res.json();
  }

  // =========================
  // PIPELINE COMPLETO
  // =========================
  static async generateAffiliateLink(link) {
    const productUrl = typeof link === "string" ? link : link.original_url;

    log.info(
      `🎯 Iniciando geração de link para: ${productUrl.substring(0, 80)}...`,
    );

    const MAX_GENERATES = 3;
    const CHECK_INTERVAL = 30_000;
    const MAX_WAIT = 8 * 60_000;
    const GENERATE_RETRY_DELAYS = [0, 10_000, 15_000]; // 0s, 10s, 15s

    for (let gen = 1; gen <= MAX_GENERATES; gen++) {
      log.info(`🚀 Tentativa ${gen}/${MAX_GENERATES}`);

      let processId;

      try {
        processId = await this.generate(productUrl);
        log.info(`📦 Process ID gerado: ${processId}`);
      } catch (err) {
        log.error(`❌ Erro no generate (tentativa ${gen}):`, err.message);
        
        // ✅ CORREÇÃO: Aguardar antes de próxima tentativa (exceto se for última)
        if (gen < MAX_GENERATES) {
          const delay = GENERATE_RETRY_DELAYS[gen];
          log.info(`⏳ Aguardando ${delay / 1000}s antes de próxima tentativa...`);
          await sleep(delay);
        }
        continue;
      }

      const start = Date.now();
      let attempts = 0;

      while (Date.now() - start < MAX_WAIT) {
        attempts++;

        let result;

        try {
          result = await this.check(processId);
        } catch (err) {
          log.warn(`⚠️ Check falhou (tentativa ${attempts}):`, err.message);
          await sleep(CHECK_INTERVAL);
          continue;
        }

        const status = result?.status;

        log.info(`🔍 Status: ${status}`);

        // ============ SUCCESS ============
        if (
          (status === "completed" || status === "success") &&
          result.data?.affiliate_link
        ) {
          log.info("✅ Link gerado com sucesso!");
          return this.buildFinalPayload(result.data, link);
        }

        // ============ FAILED ============
        if (status === "failed") {
          log.warn("❌ Job falhou — nova geração");
          break;
        }

        // ============ PENDING / NOT_FOUND / PROCESSING ============
        if (
          status === "pending" ||
          status === "not_found" ||
          status === "processing"
        ) {
          log.info("⏳ Processando...");
          await sleep(CHECK_INTERVAL);
          continue;
        }

        log.warn("⚠️ Status desconhecido:", status);
        log.warn("📋 Objeto retornado:", JSON.stringify(result, null, 2));
        await sleep(CHECK_INTERVAL);
      }

      log.warn(
        `⏱️ Timeout na tentativa ${gen} (${MAX_WAIT}ms) — tentando novamente`,
      );
    }

    log.error(`❌ Falha após ${MAX_GENERATES} tentativas de geração`);
    return {
      success: false,
      error: "Falha após 3 tentativas de geração",
      permanent_failure: true
    };
  }

  // =========================
  // ENRIQUECIMENTO DE DADOS
  // =========================
  static async buildFinalPayload(apiData, link) {
    log.info(`🛠️ Iniciando enriquecimento para: ${apiData.product_title}`);

    const whatsappData = this.extractWhatsAppData(link?.copy_text);
    // ✅ CORREÇÃO BUG #5: Removido breakpoint()

    // ✅ CORREÇÃO BUG #9: Spread ANTES de definir cupom para evitar sobrescrita
    let metadata = {
      affiliate_link: apiData.affiliate_link,
      product_title: apiData.product_title || "",
      product_price: apiData.product_price || null,
      price_original: apiData.price_original || null,
      product_image: apiData.product_image || null,
      price_from: whatsappData.price_from || null,
      price_to: whatsappData.price_to || null,
      description: whatsappData.description || null,
      image: whatsappData.image || null,

      // ✅ Spread ANTES do cupom
      ...whatsappData,
      
      // ✅ Cupom definido POR ÚLTIMO para garantir que não seja sobrescrito
      cupom: whatsappData.cupom || null,
    };

    log.info(
      `📊 Metadados básicos:`,
      JSON.stringify({
        title: metadata.product_title,
        price: metadata.product_price,
        has_image: !!metadata.product_image,
        has_cupom: !!metadata.cupom, // ✅ Log adicional para debug
      }),
    );

    if (ProductDescriptionAI.init()) {
      try {
        log.info("🤖 Gerando descrição com IA...");
        const aiDescription =
          await ProductDescriptionAI.generateProductDescription(
            metadata.product_title,
            whatsappData.description || "",
          );

        if (aiDescription) {
          metadata.ai_description = aiDescription;
          log.info("✨ Descrição gerada com sucesso");
        } else {
          log.warn("⚠️ IA retornou descrição vazia");  
        }
      } catch (err) {
        log.warn("⚠️ IA falhou:", err.message);
      }
    } else {
      log.warn("⚠️ IA não foi inicializada");
    }

    log.info(
      `✅ Payload final pronto com ${Object.keys(metadata).length} campos`,
    );
    return {
      success: true,
      affiliate_link: metadata.affiliate_link,
      metadata,
    };
  }

  // =========================
  // EXTRAÇÃO WHATSAPP
  // =========================
  static extractWhatsAppData(copyTextStr) {
    try {
      if (!copyTextStr) return {};

      const data = JSON.parse(copyTextStr);
      const extracted = {};

      if (data.title?.trim()) {
        extracted.title = data.title.trim();
      }

      if (data.description?.trim()) {
        extracted.description = data.description.trim();
      }

      // ✅ CORREÇÃO BUG #4: Buscar cupom em múltiplas fontes
      // Montar candidateText com todos os campos de texto disponíveis
      const candidateText = [
        data.text,
        data.description,
        data.msg?.conversation,
        data.msg?.extendedTextMessage?.text,
        data.msg?.imageMessage?.caption,
        data.msg?.videoMessage?.caption,
        data.msg?.ephemeralMessage?.conversation,
        data.msg?.ephemeralMessage?.extendedTextMessage?.text
      ]
        .filter(Boolean)
        .join("\n");

      // ✅ LOG DE DEBUG
      log.info(`🔍 [CUPOM DEBUG] candidateText (primeiros 300 chars): ${candidateText.substring(0, 300)}`);

      // ✅ CORREÇÃO BUG #5: Removido breakpoint()
      if (candidateText) {
        const priceData = this.extractPrices(candidateText);
        Object.assign(extracted, priceData);
        
        // ✅ LOG DE DEBUG
        log.info(`🔍 [CUPOM DEBUG] Dados extraídos: ${JSON.stringify(priceData)}`);
        log.info(`🔍 [CUPOM DEBUG] Cupom extraído: ${priceData.cupom || 'NÃO ENCONTRADO'}`);
      }

      if (data.jpegThumbnail && this.isValidBase64(data.jpegThumbnail)) {
        extracted.image = `data:image/jpeg;base64,${data.jpegThumbnail}`;
      }

      // ✅ Log adicional para debug
      if (extracted.cupom) {
        log.info(`🎟️ Cupom extraído com sucesso: ${extracted.cupom}`);
      } else {
        log.info(`⚠️ Nenhum cupom encontrado no texto candidato`);
      }

      return extracted;
    } catch (err) {
      log.warn("Falha ao extrair WhatsApp:", err.message);
      return {};
    }
  }

  static extractPrices(text) {
    const out = {};

    const norm = text.toLowerCase();

    const de = norm.match(/de\s*r?\$?\s*([\d.,]+)/);
    const por = norm.match(/por\s*r?\$?\s*([\d.,]+)/);

    const cupom = this.extractCupomCode(text); // 👈 usa TEXTO ORIGINAL

    if (de) out.price_from = `R$ ${de[1]}`;
    if (por) out.price_to = `R$ ${por[1]}`;
    if (cupom) out.cupom = cupom;

    return out;
  }

  static isValidBase64(str) {
    return typeof str === "string" && str.length > 100;
  }

  static extractCupomCode(text) {
    if (!text) return null;

    // ✅ CORREÇÃO: Regex melhorada para capturar cupons cercados por *, _, ou outros caracteres
    // Aceita: "cupom: XPTO", "cupom: *XPTO*", "código do cupom: _XPTO_", etc.
    const regex = /(?:cupom|c[oó]digo(?:\s+do\s+cupom)?)\s*[:\-]?\s*[*_~`]*([A-Za-z0-9_-]{4,30})[*_~`]*/i;

    const match = text.match(regex);

    // ✅ Verificar se match[1] existe
    if (!match || !match[1]) return null;

    // ✅ Retornar grupo 1 limpo de espaços
    return match[1].trim();
  }
}