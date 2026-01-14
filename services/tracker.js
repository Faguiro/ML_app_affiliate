// services/tracker.js
import { db } from '../database/db.js';
import { config } from '../core/config.js';
import { log } from '../core/logger.js';

export class LinkTracker {
    static extractLinks(text) {
        console.log('Extraindo links de:', text);
        const urlRegex = /https?:\/\/[^\s]+/gi;
        return (text.match(urlRegex) || []).map(url => ({
            url,
            domain: new URL(url).hostname.replace('www.', '')
        }));
    }

    static isRegisteredDomain(domain) {
        console.log('Verificando domínio registrado:', domain);
        const result = db.get(
            'SELECT id FROM affiliate_domains WHERE domain = ? AND is_active = 1',
            [domain]
        );
        console.log('Resultado da consulta:', result);
        return !!result;
    }

    static async track(sock, msg) {
        try {
            const jid = msg.key.remoteJid;

            // Ignorar se não for grupo
            if (!jid.endsWith('@g.us')) return 0;

            // Ignorar mensagens do próprio bot
            if (msg.key.fromMe) return 0;

            // Ignorar grupos da lista de envio
            const isTargetGroup = db.get(
                `SELECT id FROM target_groups WHERE group_jid = ?`,
                [jid]
            );

            if (isTargetGroup) {
                log.info(`Ignorando mensagem de grupo de envio: ${jid}`);
                return 0;
            }

            // Extrair texto
            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text || '';

            // Extrair links
            const links = this.extractLinks(text);
       
            console.log('Links extraídos:', links || []); 
            if (links.length === 0) return 0;

            // Filtrar apenas links de domínios registrados
            const validLinks = links.filter(link => this.isRegisteredDomain(link.domain));
            if (validLinks.length === 0) return 0;

            console.log(JSON.stringify(msg, null, 2)); 

            // Obter informações do grupo
            let groupName = 'Desconhecido';
            try {
                const metadata = await sock.groupMetadata(jid);
                groupName = metadata.subject;

                // Registrar grupo se não existir
                db.run(
                    `INSERT OR IGNORE INTO tracked_groups (group_jid, group_name)
                    VALUES (?, ?)`,
                    [jid, groupName]
                );

            } catch (error) {
                log.error('Erro ao obter metadata do grupo', error);
            }

            // Salvar cada link (evitando duplicados)
            let savedCount = 0;
            for (const link of validLinks) {
                // ✅ VERIFICAR SE LINK JÁ EXISTE COMO ORIGINAL_URL
                const existsAsOriginal = db.get(
                    `SELECT id FROM tracked_links WHERE original_url = ?`,
                    [link.url]
                );

                if (existsAsOriginal) {
                    log.info(`Link já rastreado como original: ${link.url.substring(0, 50)}...`);
                    continue;
                }

                // ✅ VERIFICAR SE LINK JÁ EXISTE COMO AFFILIATE_LINK
                const existsAsAffiliate = db.get(
                    `SELECT id FROM tracked_links WHERE affiliate_link = ?`,
                    [link.url]
                );

                if (existsAsAffiliate) {
                    log.info(`Link já existe como afiliado: ${link.url.substring(0, 50)}...`);
                    continue;
                }

                // ✅ OPÇÃO 3: Verificar se é similar a algum affiliate_link
                // (útil se os links forem encurtados de forma diferente)
                const similarExists = db.get(
                    `SELECT id, original_url, affiliate_link FROM tracked_links 
                    WHERE affiliate_link LIKE ? OR original_url LIKE ?`,
                    [`%${new URL(link.url).pathname}%`, `%${new URL(link.url).pathname}%`]
                );

                if (similarExists) {
                    log.info(`Link similar já existe: ${link.url.substring(0, 50)}...`);
                    continue;
                }

                let copy =  JSON.stringify(msg.message?.extendedTextMessage)

                // Inserir link
                db.run(
                    `INSERT INTO tracked_links 
                    (original_url, domain, group_jid, sender_name, status, copy_text)
                    VALUES (?, ?, ?, ?, 'pending', ?)`,
                    [
                        link.url,
                        link.domain,
                        jid,
                        msg.pushName || 'Desconhecido',
                        copy || ''
                    ]
                );

                savedCount++;
                log.info(`✅ Link rastreado: ${link.domain} em ${groupName}`);
                
            }

            return savedCount;

        } catch (error) {
            log.error('Erro no rastreamento', error);
            return 0;
        }
    }

    static getPendingLinks(limit = 20) {
        return db.query(
            `SELECT * FROM tracked_links 
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT ?`,
            [limit]
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