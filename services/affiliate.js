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

    for (let gen = 1; gen <= MAX_GENERATES; gen++) {
      log.info(`🚀 Tentativa ${gen}/${MAX_GENERATES}`);

      let processId;

      try {
        processId = await this.generate(productUrl);
        log.info(`📦 Process ID gerado: ${processId}`);
      } catch (err) {
        log.error(`❌ Erro no generate (tentativa ${gen}):`, err.message);
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
        // console.log(
        //   "📦 Resposta completa da API:",
        //   JSON.stringify(result, null, 2),
        // );

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

    let metadata = {
      affiliate_link: apiData.affiliate_link,
      product_title: apiData.product_title || "",
      product_price: apiData.product_price || null,
      price_original: apiData.price_original || null,
      product_image: apiData.product_image || null,
      cupom: whatsappData.cupom || null,
      price_from: whatsappData.price_from || null,
      price_to: whatsappData.price_to || null,
      description: whatsappData.description || null,
      image: whatsappData.image || null,

      ...whatsappData,
    };

    log.info(
      `📊 Metadados básicos:`,
      JSON.stringify({
        title: metadata.product_title,
        price: metadata.product_price,
        has_image: !!metadata.product_image,
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

      if (data.text) {
        Object.assign(extracted, this.extractPrices(data.text));
      }

      if (data.jpegThumbnail && this.isValidBase64(data.jpegThumbnail)) {
        extracted.image = `data:image/jpeg;base64,${data.jpegThumbnail}`;
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

  const regex = /(cupom|código)( do cupom)?\s*[:\-]?\s*([A-Za-z0-9]{4,30})/i;

  const match = text.match(regex);

  if (!match) return null;

  return match[3].trim();
}



}
