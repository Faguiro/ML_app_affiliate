// services/scheduler.js - REFATORADO COM TRATAMENTO INTELIGENTE DE ESTADOS
import { db } from "../database/db.js";
import { LinkTracker } from "./tracker.js";
import { AffiliateService } from "./affiliate.js";
import { config } from "../core/config.js";
import { log } from "../core/logger.js";
import { DataNormalizer } from "./data-normalizer.js";
import { MessageBuilder } from "./message-builder.js";


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Scheduler {

    constructor(sock) {
        this.sock = sock;
        this.processing = false;
        this.sending = false;
        this.authFailureDetected = false; // Flag para parar tentativas em caso de auth failure

        this.processIntervalId = null;
        this.sendIntervalId = null;
        this.dailyResetTimeoutId = null;
        this.dailyResetIntervalId = null;
        
    }

    start() {
        // 1. Segurança: Se já tiver IDs, significa que já está rodando.
        // Opção A: Retornar e não fazer nada
        if (this.processIntervalId || this.sendIntervalId) {
            log.warn("⚠️ Tentativa de iniciar Scheduler duplicado ignorada.");
            return;
        }

        // Opção B (Recomendada): Forçar parada limpa antes de iniciar
        // this.stop();

        log.info("🚀 Iniciando Scheduler...");

        // 2. Configurar intervalos e SALVAR os IDs
        // Nota: Adicionei valores padrão caso a config venha vazia
        const pInterval = config.processInterval || 60000;
        const sInterval = config.sendInterval || 120000;

        this.processIntervalId = setInterval(() => this.processLinks(), pInterval);
        log.info(`✅ Processamento agendado para cada ${pInterval / 1000}s`);

        this.sendIntervalId = setInterval(() => this.sendLinks(), sInterval);
        log.info(`✅ Envio agendado para cada ${sInterval / 1000}s`);

        try {
            this.markPermanentFailures();
            this.markTemporaryFailuresAsPending();;
        } catch (error) {
            log.error("💥 Erro ao marcar falhas temporárias/permanentes:", error);
        }

        // 3. Reset diário
        this.scheduleDailyReset();
    }

    stop() {
        log.info("🛑 Parando Scheduler...");

        // --- NOVO: Limpeza real dos intervalos ---

        // Parar Processamento
        if (this.processIntervalId) {
            clearInterval(this.processIntervalId);
            this.processIntervalId = null;
        }

        // Parar Envio
        if (this.sendIntervalId) {
            clearInterval(this.sendIntervalId);
            this.sendIntervalId = null;
        }

        // Parar Reset Diário (Timeout inicial)
        if (this.dailyResetTimeoutId) {
            clearTimeout(this.dailyResetTimeoutId);
            this.dailyResetTimeoutId = null;
        }

        // Parar Reset Diário (Intervalo recorrente)
        if (this.dailyResetIntervalId) {
            clearInterval(this.dailyResetIntervalId);
            this.dailyResetIntervalId = null;
        }

        // Resetar flags de estado
        this.processing = false;
        this.sending = false;

        log.info("✅ Scheduler parado e intervalos limpos.");
    }

    /**
     * Log do status atual dos links no banco
     */
    _logLinkStatus() {
        try {
            const statusCounts = db.query(
                `SELECT status, COUNT(*) as count FROM tracked_links GROUP BY status`,
            );

            const statusMap = {};
            if (statusCounts && statusCounts.length > 0) {
                statusCounts.forEach((row) => {
                    statusMap[row.status] = row.count;
                });
            }

            // Garantir que todas as status apareçam (mesmo que com 0)
            const allStatus = ["pending", "ready", "failed", "failed_temporary"];
            const finalStatus = {};

            allStatus.forEach((status) => {
                finalStatus[status] = statusMap[status] || 0;
            });

            // log.info(`📊 Status dos links no banco: ${JSON.stringify(finalStatus)}`);
        } catch (error) {
            log.warn("⚠️ Erro ao contar status dos links:", error.message);
        }
    }

    /**
     * Parte 1 - Processa links pendentes com tratamento inteligente de estados
     */
    async processLinks() {
        if (this.processing) return;

        // Se detectou falha de autenticação, parar processamento
        if (this.authFailureDetected) {
            log.error("⚠️ Processamento pausado: falha de autenticação detectada");
            log.error("   Atualize os cookies e reinicie o sistema");
            return;
        }

        this.processing = true;

        try {
            // Log do status atual dos links
            this._logLinkStatus();

            log.info("🔄 Processando links pendentes...");
            const pendingLinks = await LinkTracker.getPendingLinks(10);

            if (pendingLinks.length === 0) {
                log.info("✅ Nenhum link pendente");
                return;
            }

            log.info(`📋 ${pendingLinks.length} links para processar`);

            for (const link of pendingLinks) {
                try {
                    console.log(`\n${"=".repeat(60)}`);
                    console.log(`🔗 Processando link ID ${link.id}`);
                    console.log(`URL: ${link.original_url.substring(0, 170)}...`);

                    const result = await AffiliateService.generateAffiliateLink(link);

                    console.log(`📦 Resultado:`, {
                        success: result.success,
                        has_link: !!result.affiliate_link,
                        has_cupom: !!result.metadata?.cupom, // ✅ Log de debug cupom
                    });

                    // ========== TRATAR RESULTADO ==========
                    await this._handleProcessResult(link, result);

                    // Pequena pausa para evitar rate limit
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                } catch (error) {
                    log.error(`❌ Erro ao processar link ${link.id}:`, error.message);

                    // Marcar como failed_temporary para tentar novamente depois
                    LinkTracker.updateLinkStatus(link.id, "failed_temporary", null, {
                        error: error.message,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        } catch (error) {
            log.error("💥 Erro crítico no processamento de links:", error);
        } finally {
            this.processing = false;
        }
    }

    /**
     * Trata o resultado do processamento de forma inteligente
     */
    async _handleProcessResult(link, result) {
        const linkId = link.id;

        // ========== SUCESSO ==========
        if (result.success && result.affiliate_link) {
            log.info(`✅ Link ${linkId} processado com sucesso`);

            LinkTracker.updateLinkStatus(
                linkId,
                "ready",
                result.affiliate_link,
                result.metadata,
            );

            return;
        }

        // ========== FALHA PERMANENTE (após 3 tentativas) ==========
        if (result.permanent_failure) {
            log.error(`❌ Link ${linkId} marcado como falha permanente`);

            LinkTracker.updateLinkStatus(linkId, "failed", null, {
                error: result.error || "Falha permanente após 3 tentativas",
                permanent_failure: true,
                timestamp: new Date().toISOString(),
            });

            return;
        }

        // ========== FALHA TEMPORÁRIA ==========
        LinkTracker.updateLinkStatus(linkId, "pending", null, {
            error: result.error || "Unknown status",
            status_received: result.status,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Notifica sobre falha de autenticação
     */
    _notifyAuthFailure(result) {
        console.error("\n" + "=".repeat(70));
        console.error("🚨 ATENÇÃO: FALHA DE AUTENTICAÇÃO DETECTADA");
        console.error("=".repeat(70));
        console.error("Mensagem:", result.error);
        console.error("Ação necessária:", result.requires_action);
        console.error("\nO processamento foi PAUSADO.");
        console.error("Para continuar:");
        console.error("1. Atualize os cookies no arquivo config.json");
        console.error("2. Reinicie o sistema");
        console.error("=".repeat(70) + "\n");

        // TODO: Implementar notificação via email/telegram/webhook
    }

    /**
     * Parte 2 - Envia links processados para grupos
     * ✅ CORREÇÃO BUG #7: Melhor tratamento de erros
     */   
   
     async sendLinks() {
        if (this.sending) return;
        this.sending = true;

        try {
            log.info("📤 Buscando links para envio...");

            // 🔒 Lock + fetch atômico
            const readyLinks = await db.fetchAndLockLinks(5);

            if (!readyLinks.length) {
                log.info("Nenhum link pronto");
                return;
            }

            const targetGroups = await db.query(
                `SELECT * FROM target_groups WHERE is_active = 1`
            );

            if (!targetGroups.length) return;

            for (const link of readyLinks) {
                try {
                    const apiMetadata = this._parseMetadata(link.metadata);
                    const whatsappCopy = this._parseCopyText(link.copy_text);

                    const normalized = DataNormalizer.normalize(
                        apiMetadata,
                        whatsappCopy
                    );

                    normalized.affiliate_link ||= 
                        apiMetadata.affiliate_link || link.affiliate_link;

                    if (!normalized.affiliate_link) {
                        // ✅ CORREÇÃO BUG #7: Erro de payload inválido = failed permanente
                        log.error(`❌ Link ${link.id}: Affiliate link ausente (payload inválido)`);
                        
                        await db.run(
                            `UPDATE tracked_links 
                            SET status = 'failed', metadata = ? 
                            WHERE id = ?`,
                            [
                                JSON.stringify({
                                    error: "Affiliate link ausente no payload",
                                    permanent_failure: true,
                                    timestamp: new Date().toISOString()
                                }),
                                link.id
                            ]
                        );
                        continue;
                    }

                    const payload = MessageBuilder.buildPayload(normalized);

                    if (!payload?.text && !payload?.caption) {
                        // ✅ CORREÇÃO BUG #7: Erro de payload inválido = failed permanente
                        log.error(`❌ Link ${link.id}: Payload inválido (sem texto ou caption)`);
                        
                        await db.run(
                            `UPDATE tracked_links 
                            SET status = 'failed', metadata = ? 
                            WHERE id = ?`,
                            [
                                JSON.stringify({
                                    error: "Payload inválido: sem texto ou caption",
                                    permanent_failure: true,
                                    timestamp: new Date().toISOString()
                                }),
                                link.id
                            ]
                        );
                        continue;
                    }

                    // ✅ Log de debug do cupom no payload final
                    log.info(`📤 Enviando link ${link.id} - Cupom: ${normalized.cupom || 'N/A'}`);

                    for (const group of targetGroups) {
                        if (!db.canSendToGroup(group.group_jid)) continue;

                        try {
                            await this.sock.sendMessage(group.group_jid, payload);

                            await db.run(
                                `INSERT INTO sent_links 
                                (tracked_link_id, target_group_jid, message)
                                VALUES (?, ?, ?)`,
                                [link.id, group.group_jid, payload.caption || payload.text]
                            );

                            db.incrementSentCount(group.group_jid);

                            await sleep(5000);

                        } catch (sendError) {
                            // ✅ CORREÇÃO BUG #7: Erro de envio = failed_temporary
                            log.error(`⚠️ Erro ao enviar para grupo ${group.group_name}:`, sendError.message);
                            
                            // Continua para próximo grupo, mas marca link como failed_temporary
                            await db.run(
                                `UPDATE tracked_links 
                                SET status = 'failed_temporary', metadata = ? 
                                WHERE id = ?`,
                                [
                                    JSON.stringify({
                                        error: `Erro no envio: ${sendError.message}`,
                                        group: group.group_name,
                                        timestamp: new Date().toISOString()
                                    }),
                                    link.id
                                ]
                            );
                        }
                    }

                    // ✅ Finaliza link com sucesso
                    // await db.run(
                    //     `UPDATE tracked_links 
                    //     SET status = 'sent' 
                    //     WHERE id = ?`,
                    //     [link.id]
                    // );

                } catch (err) {
                    // ✅ CORREÇÃO BUG #7: Distinguir entre erros permanentes e temporários
                    const isPayloadError = err.message.includes("ausente") || 
                                          err.message.includes("inválido");
                    
                    const newStatus = isPayloadError ? 'failed' : 'failed_temporary';
                    
                    log.error(`Falha no link ${link.id} - Status: ${newStatus}`, err);

                    await db.run(
                        `UPDATE tracked_links 
                        SET status = ?, metadata = ? 
                        WHERE id = ?`,
                        [
                            newStatus,
                            JSON.stringify({
                                error: err.message,
                                permanent_failure: isPayloadError,
                                timestamp: new Date().toISOString()
                            }),
                            link.id
                        ]
                    );
                }

                await sleep(15000);
            }

        } catch (err) {
            log.error("Erro geral no envio", err);
        } finally {
            this.sending = false;
        }
    }

    // ==========================================================================

    // ==================== HELPERS ====================

    _parseMetadata(metadataStr) {
        try {
            if (!metadataStr) return {};
            const parsed = JSON.parse(metadataStr);
            return parsed;
        } catch (error) {
            log.error("Erro ao parsear metadata:", error.message);
            return {};
        }
    }

    _parseCopyText(copyTextStr) {
        try {
            if (!copyTextStr) return {};
            const parsed = JSON.parse(copyTextStr);
            return parsed;
        } catch (error) {
            log.error("Erro ao parsear copy_text:", error.message);
            return {};
        }
    }

    _logGroupStatus(group) {
        console.log(`  ⏸️ Grupo ${group.group_name} não pode receber envio agora`);

        const groupInfo = db.get(
            `SELECT sent_today, daily_limit, last_reset, last_sent 
             FROM target_groups WHERE group_jid = ?`,
            [group.group_jid],
        );

        if (groupInfo) {
            console.log(`  📈 Status do grupo: 
              Enviados hoje: ${groupInfo.sent_today}/${groupInfo.daily_limit}
              Último reset: ${groupInfo.last_reset}
              Último envio: ${groupInfo.last_sent}`);
        }
    }

    // ==================== SCHEDULER ====================

    scheduleDailyReset() {
        // Limpar agendamento anterior se houver
        if (this.dailyResetTimeoutId) clearTimeout(this.dailyResetTimeoutId);

        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const msUntilMidnight = midnight - now;

        log.info(
            `📅 Reset diário agendado para daqui a ${(msUntilMidnight / 1000 / 60).toFixed(1)} min`,
        );

        this.dailyResetTimeoutId = setTimeout(() => {
            this.resetDailyCounters();

            // Inicia o intervalo de 24h
            if (this.dailyResetIntervalId) clearInterval(this.dailyResetIntervalId);

            this.dailyResetIntervalId = setInterval(
                () => {
                    this.resetDailyCounters();
                },
                24 * 60 * 60 * 1000,
            );
        }, msUntilMidnight);
    }

    resetDailyCounters() {
        db.run(`UPDATE target_groups SET sent_today = 0, last_reset = date('now')`);
        log.info("Contadores diários resetados");

        // Reset auth failure flag no início do dia
        this.authFailureDetected = false;
    }

    /**
     * Método para resetar manualmente a flag de auth failure
     * (chamar após atualizar cookies)
     */
    resetAuthFailureFlag() {
        this.authFailureDetected = false;
        log.info("✅ Flag de falha de autenticação resetada");
    }

    // ==================== Tratar temrary_failure ====================

    /**
     * Método para passar a flag "failed_temporary" para "failed"
     * (chamar periodicamente para limpar links que falharam várias vezes)
     */
    markPermanentFailures() {        

        try {
            const result = db.run(
            `UPDATE tracked_links
            SET status = 'failed'
            WHERE status = 'failed_temporary'
            AND (created_at IS NULL OR (julianday('now') - julianday(created_at)) > 1);`,
            );
            log.info(
                `✅ Links marcados como permanentemente falhados: ${result.changes}`,
            );
        } catch (error) {
            log.error("💥 Erro ao marcar falhas permanentes:", error);
        } 
    }

    markTemporaryFailuresAsPending() {
        // pegar o mais antigo (1 registro apenas)
        const result = db.run(
            `UPDATE tracked_links 
             SET status = 'pending' 
             WHERE status = 'failed_temporary' 
               AND ((julianday('now') - julianday(processed_at)) * 24) > 1
               LIMIT 1`,
        );
        log.info(`✅ Links marcados como pendentes: ${result.changes}`);
    }

}