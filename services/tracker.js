// services/tracker.js
import { db } from "../database/db.js";
import { config } from "../core/config.js";
import { log } from "../core/logger.js";

export class LinkTracker {
  static extractLinks(text) {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urls = text.match(urlRegex) || [];
    
    // ✅ CORREÇÃO BUG #2: Remover URLs do texto para obter descrição limpa
    let description = text;
    urls.forEach(url => {
      description = description.replace(url, '');
    });
    description = description.trim();

    return urls.map((url) => ({
      url,
      domain: new URL(url).hostname.replace("www.", ""),
      description: description || "",
    }));
  }

  static isRegisteredDomain(domain) {
    log.info(`Verificando domínio registrado: ${domain}`);
    const result = db.get(
      "SELECT id FROM affiliate_domains WHERE domain = ? AND is_active = 1",
      [domain],
    );
    if (result) {
      log.info(`Domínio registrado encontrado: ${domain}`);
    } else {
      log.info(`Domínio não registrado: ${domain}`);
    }
    return !!result;
  }

  static async track(sock, msg, text) {
    try {
      const jid = msg.key.remoteJid;

      // Ignorar se não for grupo
      if (!jid.endsWith("@g.us")) return 0;

      // Ignorar mensagens do próprio bot
      if (msg.key.fromMe) return 0;

      // Ignorar grupos da lista de envio
      const isTargetGroup = db.get(
        `SELECT id FROM target_groups WHERE group_jid = ?`,
        [jid],
      );

      if (isTargetGroup) {
        log.info(`Ignorando mensagem de grupo de envio: ${jid}`);
        return 0;
      }

      // ✅ CORREÇÃO BUG #1: Resolver texto com fallback robusto para estruturas Baileys
      const rawText = (
        text ||
        msg?.message?.extendedTextMessage?.text ||
        msg?.message?.conversation ||
        msg?.message?.imageMessage?.caption ||
        msg?.message?.videoMessage?.caption ||
        msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        msg?.message?.ephemeralMessage?.message?.conversation ||
        ""
      ).trim();
      if( rawText.length === 0) {
        rawText = text || "";
      }

      // se text contem "www." ou "http" ou "https"
      if (!rawText.includes("www.") && !rawText.includes("http")) {
        return 0;
      }

      //Se for link de whatsapp ignorar
      if (rawText.includes("https://chat.whatsapp.com/")) {
        return 0;
      }

      // Ignorar facebook, youtube e instagram
      if (
        rawText.includes("facebook.com") ||
        rawText.includes("youtube.com") ||
        rawText.includes("youtu.be") ||
        rawText.includes("twitter.com") ||
        rawText.includes("instagram.com") ||
        rawText.includes("t.me") ||
        rawText.includes("tiktok.com") ||
        rawText.includes("open.spotify.com") ||
        rawText.includes("oia.99app.com") ||
        rawText.includes("ifood.com.br") ||
        rawText.includes("play.google.com") ||
        rawText.includes("app.apple.com")
      ) {
        return 0;
      }

      // Extrair links usando rawText
      const links = this.extractLinks(rawText);

      log.info("Links extraídos:", links || []);
      if (links.length === 0) return 0;

      // Filtrar apenas links de domínios registrados
      const validLinks = links.filter((link) =>
        this.isRegisteredDomain(link.domain),
      );
      if (validLinks.length === 0) return 0;

      // Obter informações do grupo
      let groupName = "Desconhecido";
      try {
        const metadata = await sock.groupMetadata(jid);
        groupName = metadata.subject;

        // Registrar grupo se não existir
        db.run(
          `INSERT OR IGNORE INTO tracked_groups (group_jid, group_name)
                    VALUES (?, ?)`,
          [jid, groupName],
        );
      } catch (error) {
        log.error("Erro ao obter metadata do grupo", error);
        return 0;
      }

      // Salvar cada link (evitando duplicados)
      let savedCount = 0;
      for (const link of validLinks) {
        // ✅ VERIFICAR SE LINK JÁ EXISTE COMO ORIGINAL_URL
        const existsAsOriginal = db.get(
          `SELECT id FROM tracked_links WHERE original_url = ?`,
          [link.url],
        );

        if (existsAsOriginal) {
          log.info(
            `Link já rastreado como original: ${link.url.substring(0, 50)}...`,
          );
          continue;
        }

        // ✅ VERIFICAR SE LINK JÁ EXISTE COMO AFFILIATE_LINK
        const existsAsAffiliate = db.get(
          `SELECT id FROM tracked_links WHERE affiliate_link = ?`,
          [link.url],
        );

        if (existsAsAffiliate) {
          log.info(
            `Link já existe como afiliado: ${link.url.substring(0, 50)}...`,
          );
          continue;
        }

        // ✅ CORREÇÃO BUG #3: Salvar copy_text com estrutura robusta
        // Inclui tanto o texto resolvido quanto partes relevantes do objeto msg
        const copy = {
          text: rawText,
          description: link.description || rawText,
          msg: {
            conversation: msg?.message?.conversation,
            extendedTextMessage: msg?.message?.extendedTextMessage,
            imageMessage: msg?.message?.imageMessage 
              ? {
                  caption: msg.message.imageMessage.caption,
                  jpegThumbnail: msg.message.imageMessage.jpegThumbnail
                }
              : undefined,
            videoMessage: msg?.message?.videoMessage
              ? {
                  caption: msg.message.videoMessage.caption,
                  jpegThumbnail: msg.message.videoMessage.jpegThumbnail
                }
              : undefined,
            ephemeralMessage: msg?.message?.ephemeralMessage?.message
              ? {
                  conversation: msg.message.ephemeralMessage.message.conversation,
                  extendedTextMessage: msg.message.ephemeralMessage.message.extendedTextMessage
                }
              : undefined
          }
        };

        const copy_text = JSON.stringify(copy);
        
        // Inserir link
        db.run(
          `INSERT INTO tracked_links 
                    (original_url, domain, group_jid, sender_name, status, copy_text)
                    VALUES (?, ?, ?, ?, 'pending', ?)`,
          [
            link.url,
            link.domain,
            jid,
            msg.pushName || "Desconhecido",
            copy_text || "",
          ],
        );

        savedCount++;
        log.info(`✅ Link rastreado: ${link.domain} em ${groupName}`);
      }

      return savedCount;
    } catch (error) {
      log.error("Erro no rastreamento", error);
      return 0;
    }
  }

  static getPendingLinks(limit = 20) {
    return db.query(
      `SELECT * FROM tracked_links 
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT ?`,
      [limit],
    );
  }

  static updateLinkStatus(id, status, affiliateLink = null, metadata = null) {
    const params = [status];
    let sql = `UPDATE tracked_links SET status = ?`;

    if (affiliateLink) {
      sql += `, affiliate_link = ?, processed_at = datetime('now')`;
      params.push(affiliateLink);
    }

    if (metadata) {
      sql += `, metadata = ?`;
      params.push(JSON.stringify(metadata));
    }

    sql += ` WHERE id = ?`;
    params.push(id);

    db.run(sql, params);
  }
}