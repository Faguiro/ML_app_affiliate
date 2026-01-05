// services/scheduler.js
import { db } from '../database/db.js';
import { LinkTracker } from './tracker.js';
import { AffiliateService } from './affiliate.js';
import { config } from '../core/config.js';
import { log } from '../core/logger.js';

export class Scheduler {
    constructor(sock) {
        this.sock = sock;
        this.processing = false;
        this.sending = false;
    }

    start() {
        // Processar links pendentes
        setInterval(() => this.processLinks(), config.processInterval);
        log.info('intervalo do processo:', config.processInterval);

        // Enviar links processados
        setInterval(() => this.sendLinks(), config.sendInterval);
        log.info('intervalo do envio:', config.sendInterval);

        // Reset diário à meia-noite
        this.scheduleDailyReset();

        // log.info('Agendador iniciado');
    }

    async processLinks() {
        if (this.processing) return;
        this.processing = true;

        try {
            log.info('Processando links pendentes...');
            const pendingLinks = await LinkTracker.getPendingLinks(10);

            for (const link of pendingLinks) {
                try {
                    const result = await AffiliateService.generateAffiliateLink(link);
                    log.info(`Link ${link.id} processado:`, result);

                    if (result.success) {
                        LinkTracker.updateLinkStatus(
                            link.id,
                            'ready',
                            result.affiliate_link,
                            result.metadata
                        );
                        log.info(`Link ${link.id} processado com sucesso`);
                        this.sendLinks();
                    } else {
                        LinkTracker.updateLinkStatus(link.id, 'failed');
                        log.error(`Link ${link.id} falhou: ${result.error}`);
                    }



                    // Pequena pausa para evitar rate limit
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    log.error(`Erro ao processar link ${link.id}`, error);
                }
            }

        } finally {
            this.processing = false;
        }
    }

    async sendLinks() {
        if (this.sending) return;
        this.sending = true;

        try {
            log.info('Enviando links processados...');

            // Buscar links prontos para envio
            const readyLinks = db.query(
                `SELECT tl.* FROM tracked_links tl
             LEFT JOIN sent_links sl ON tl.id = sl.tracked_link_id
             WHERE tl.status = 'ready' AND sl.id IS NULL
             ORDER BY tl.processed_at ASC
             LIMIT 5`
            );

            // Buscar grupos destino ativos
            const targetGroups = db.query(
                `SELECT * FROM target_groups WHERE is_active = 1`
            );

            console.log(`✅ Enviando ${readyLinks.length} links para ${targetGroups.length} grupos`);

            for (const link of readyLinks) {
                console.log(`🔗 Link ${link.id}: ${link.original_url?.substring(0, 50)}...`);

                for (const group of targetGroups) {
                    console.log(`  📱 Tentando grupo: ${group.group_name}`);

                    // Verificar detalhadamente
                    const canSend = db.canSendToGroup(group.group_jid);
                    console.log(`  📊 canSendToGroup retornou: ${canSend}`);

                    if (canSend) {
                        try {
                            const message = this.createMessage(link);
                            console.log(`  ✉️  Enviando mensagem...`);

                            const payload = this.createMessagePayload(link);


                            await this.sock.sendMessage(group.group_jid, payload);

                            // Registrar envio
                            db.run(
                                `INSERT INTO sent_links (tracked_link_id, target_group_jid, message)
                             VALUES (?, ?, ?)`,
                                [link.id, group.group_jid, message]
                            );

                            // Incrementar contador
                            db.incrementSentCount(group.group_jid);

                            console.log(`  ✅ Enviado com sucesso para ${group.group_name}`);

                            // Pequena pausa
                            await new Promise(resolve => setTimeout(resolve, 500));

                        } catch (error) {
                            console.error(`  ❌ Erro ao enviar:`, error.message);
                            log.error(`Erro ao enviar para ${group.group_name}`, error);
                        }
                    } else {
                        console.log(`  ⏸️  Grupo ${group.group_name} não pode receber envio agora`);

                        // Verificar por que não pode enviar
                        const groupInfo = db.get(
                            `SELECT sent_today, daily_limit, last_reset, last_sent 
                         FROM target_groups WHERE group_jid = ?`,
                            [group.group_jid]
                        );

                        if (groupInfo) {
                            console.log(`  📈 Status do grupo: 
                          Enviados hoje: ${groupInfo.sent_today}/${groupInfo.daily_limit}
                          Último reset: ${groupInfo.last_reset}
                          Último envio: ${groupInfo.last_sent}`);
                        }
                    }
                }
                // Pequena pausa entre links
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            log.error('Erro ao enviar links', error);

        } finally {
            this.sending = false;
        }
    }   

    createMessagePayload(link) {
        try {
            const metadata = link.metadata ? JSON.parse(link.metadata) : {};
            const caption = this.createMessage(link);

            // Verificar se há imagem nos metadados da IA
            if (metadata.product_image && metadata.product_image.startsWith('data:image')) {
                console.log('  🖼️  Enviando com imagem do copy_text (base64)');
                return {
                    image: { url: metadata.product_image },
                    caption: caption
                };
            }

            // Verificar se há imagem URL
            if (metadata.product_image && metadata.product_image.startsWith('http')) {
                console.log('  🖼️  Enviando com imagem URL:', metadata.product_image);
                return {
                    image: { url: metadata.product_image },
                    caption: caption
                };
            }

            console.log('  📝 Enviando como mensagem de texto');
            return { text: caption };

        } catch (error) {
            console.error('Erro ao criar payload:', error);
            return { text: this.createMessage(link) };
        }
    }

    createMessage(link) {
        console.log('  📝 Criando mensagem para o link:', JSON.stringify(link, null, 2));

        try {
            const metadata = link.metadata ? JSON.parse(link.metadata) : {};
            const copyText = link.copy_text ? JSON.parse(link.copy_text) : {};

            let message = ``;

            // Título do produto (prioridade: metadata > copy_text)
            const title = metadata.product_title || copyText.title || 'Produto Recomendado';
            message += `*${title}*\n\n`;

            // Link afiliado (sempre)
            message += `🔗 ${link.affiliate_link}\n\n`;

            // Prioridade: Descrição da IA > Fallback
            if (metadata.ai_description) {
                message += `${metadata.ai_description}\n\n`;
            } else if (copyText.description) {
                // Usar um trecho da descrição original se não houver IA
                const shortDesc = copyText.description.substring(0, 150) + '...';
                message += `${shortDesc}\n\n`;
            } else {
                message += `✨ Recomendação especial dos membros do grupo!\n\n`;
            }

            // Informações de preço (extraídas do texto original)
            if (copyText.text) {
                const priceMatch = copyText.text.match(/\*💸Por 🔥: R\$\s*([\d,.-]+(?:\s*-\s*R\$\s*[\d,.]+)?)\*/);
                if (priceMatch) {
                    message += `💰 Preço: R$ ${priceMatch[1]}\n`;
                }
            } else if (metadata.price) {
                message += `💰 ${metadata.price}\n`;
            }

            // Rodapé
            message += `🛡️ Compra 100% segura`;

            return message;

        } catch (error) {
            log.error('Erro ao criar mensagem:', error);
            return `🛍️ Recomendação especial:\n\n${link.affiliate_link}\n\nRecomendado pelo grupo ✅`;
        }
    }

    scheduleDailyReset() {
        // Calcular milissegundos até meia-noite
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const msUntilMidnight = midnight - now;

        setTimeout(() => {
            this.resetDailyCounters();
            // Agendar para todos os dias
            setInterval(() => this.resetDailyCounters(), 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    resetDailyCounters() {
        db.run(`UPDATE target_groups SET sent_today = 0, last_reset = date('now')`);
        log.info('Contadores diários resetados');
    }
}