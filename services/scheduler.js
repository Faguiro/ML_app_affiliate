// services/scheduler.js - REFATORADO COM TRATAMENTO INTELIGENTE DE ESTADOS
import { db } from '../database/db.js';
import { LinkTracker } from './tracker.js';
import { AffiliateService, ProcessStatus } from './affiliate.js';
import { config } from '../core/config.js';
import { log } from '../core/logger.js';
import { DataNormalizer } from './data-normalizer.js';
import { MessageBuilder } from './message-builder.js';

export class Scheduler {
    constructor(sock) {
        this.sock = sock;
        this.processing = false;
        this.sending = false;
        this.authFailureDetected = false; // Flag para parar tentativas em caso de auth failure
    }

    start() {
        // Processar links pendentes
        setInterval(() => this.processLinks(), config.processInterval);
        log.info('Intervalo do processo:', config.processInterval);

        // Enviar links processados
        setInterval(() => this.sendLinks(), config.sendInterval);
        log.info('Intervalo do envio:', config.sendInterval);

        // Reset diário à meia-noite
        this.scheduleDailyReset();
    }

    stop() {
        this.processing = false;
        this.sending = false;
        log.info('Agendador parado');
    }

    /**
     * Processa links pendentes com tratamento inteligente de estados
     */
    async processLinks() {
        if (this.processing) return;
        
        // Se detectou falha de autenticação, parar processamento
        if (this.authFailureDetected) {
            log.error('⚠️ Processamento pausado: falha de autenticação detectada');
            log.error('   Atualize os cookies e reinicie o sistema');
            return;
        }
        
        this.processing = true;

        try {
            log.info('🔄 Processando links pendentes...');
            const pendingLinks = await LinkTracker.getPendingLinks(10);

            if (pendingLinks.length === 0) {
                log.info('✅ Nenhum link pendente');
                return;
            }

            log.info(`📋 ${pendingLinks.length} links para processar`);

            for (const link of pendingLinks) {
                try {
                    console.log(`\n${'='.repeat(60)}`);
                    console.log(`🔗 Processando link ID ${link.id}`);
                    console.log(`URL: ${link.original_url.substring(0, 70)}...`);
                    
                    const result = await AffiliateService.generateAffiliateLink(link);
                    
                    console.log(`📦 Resultado:`, {
                        success: result.success,
                        status: result.status,
                        retry_allowed: result.retry_allowed,
                        has_link: !!result.affiliate_link
                    });

                    // ========== TRATAR RESULTADO ==========
                    await this._handleProcessResult(link, result);

                    // Pequena pausa para evitar rate limit
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    log.error(`❌ Erro ao processar link ${link.id}:`, error.message);
                    
                    // Marcar como failed_temporary para tentar novamente depois
                    LinkTracker.updateLinkStatus(
                        link.id, 
                        'failed_temporary',
                        null,
                        { error: error.message }
                    );
                }
            }

        } catch (error) {
            log.error('💥 Erro crítico no processamento de links:', error);
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
                'ready',
                result.affiliate_link,
                result.metadata
            );
            
            return;
        }

        // ========== FALHA DE AUTENTICAÇÃO ==========
        if (result.status === 'failed_auth' || result.status === ProcessStatus.FAILED_AUTH) {
            log.error(`🔒 Link ${linkId}: FALHA DE AUTENTICAÇÃO`);
            log.error(`   Mensagem: ${result.error}`);
            log.error(`   Ação necessária: ${result.requires_action}`);
            
            // Marcar como failed permanentemente
            LinkTracker.updateLinkStatus(
                linkId,
                'failed_auth',
                null,
                { 
                    error: result.error,
                    requires_action: result.requires_action,
                    timestamp: new Date().toISOString()
                }
            );
            
            // Ativar flag para parar processamento
            this.authFailureDetected = true;
            
            // Notificar administrador (implementar conforme necessário)
            this._notifyAuthFailure(result);
            
            return;
        }

        // ========== CAPTCHA DETECTADO ==========
        if (result.status === 'failed_captcha' || result.status === ProcessStatus.FAILED_CAPTCHA) {
            log.error(`🤖 Link ${linkId}: CAPTCHA DETECTADO`);
            log.error(`   Mensagem: ${result.error}`);
            
            LinkTracker.updateLinkStatus(
                linkId,
                'failed_captcha',
                null,
                { 
                    error: result.error,
                    requires_action: 'manual_intervention',
                    timestamp: new Date().toISOString()
                }
            );
            
            // Pausar processamento temporariamente
            this.authFailureDetected = true;
            
            return;
        }

        // ========== ERRO PERMANENTE ==========
        if (result.status === 'failed_permanent' || 
            result.status === ProcessStatus.FAILED_PERMANENT ||
            result.status === "failed" ||
            result.retry_allowed === false) {
            
            log.error(`❌ Link ${linkId}: ERRO PERMANENTE`);
            log.error(`   Tipo: ${result.error_type || 'unknown'}`);
            log.error(`   Mensagem: ${result.error}`);
            
            LinkTracker.updateLinkStatus(
                linkId,
                'failed',
                null,
                { 
                    error: result.error,
                    error_type: result.error_type,
                    retry_allowed: false,
                    timestamp: new Date().toISOString()
                }
            );
            
            return;
        }

        // ========== ERRO TEMPORÁRIO ==========
        if (result.status === 'failed_temporary' || 
            result.status === ProcessStatus.FAILED_TEMPORARY ||
            result.status === ProcessStatus.FAILED_NETWORK) {
            
            log.warn(`⚠️ Link ${linkId}: ERRO TEMPORÁRIO`);
            log.warn(`   Mensagem: ${result.error}`);
            log.warn(`   Será tentado novamente na próxima rodada`);
            
            // Incrementar contador de tentativas
            const currentMetadata = link.metadata ? JSON.parse(link.metadata) : {};
            const retryCount = (currentMetadata.retry_count || 0) + 1;
            
            // Se já tentou muitas vezes, marcar como failed
            if (retryCount >= 5) {
                log.error(`   ❌ Máximo de tentativas atingido (${retryCount})`);
                
                LinkTracker.updateLinkStatus(
                    linkId,
                    'failed',
                    null,
                    { 
                        error: result.error,
                        retry_count: retryCount,
                        max_retries_reached: true,
                        timestamp: new Date().toISOString()
                    }
                );
            } else {
                // Continuar como pending para tentar novamente
                LinkTracker.updateLinkStatus(
                    linkId,
                    'pending',
                    null,
                    { 
                        error: result.error,
                        retry_count: retryCount,
                        last_attempt: new Date().toISOString()
                    }
                );
            }
            
            return;
        }

        // ========== STATUS DESCONHECIDO ==========
        log.warn(`⚠️ Link ${linkId}: Status desconhecido: ${result.status}`);
        log.warn(`   Marcando como failed_temporary`);
        
        LinkTracker.updateLinkStatus(
            linkId,
            'pending',
            null,
            { 
                error: result.error || 'Unknown status',
                status_received: result.status,
                timestamp: new Date().toISOString()
            }
        );
    }

    /**
     * Notifica sobre falha de autenticação
     */
    _notifyAuthFailure(result) {
        console.error('\n' + '='.repeat(70));
        console.error('🚨 ATENÇÃO: FALHA DE AUTENTICAÇÃO DETECTADA');
        console.error('='.repeat(70));
        console.error('Mensagem:', result.error);
        console.error('Ação necessária:', result.requires_action);
        console.error('\nO processamento foi PAUSADO.');
        console.error('Para continuar:');
        console.error('1. Atualize os cookies no arquivo config.json');
        console.error('2. Reinicie o sistema');
        console.error('='.repeat(70) + '\n');
        
        // TODO: Implementar notificação via email/telegram/webhook
    }

    /**
     * Envia links processados para grupos
     */
    async sendLinks() {
        if (this.sending) return;
        this.sending = true;

        try {
            log.info('📤 Enviando links processados...');

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
                console.log(`\n🔗 Link ${link.id}: ${link.original_url?.substring(0, 50)}...`);

                for (const group of targetGroups) {
                    console.log(`  📱 Tentando grupo: ${group.group_name}`);

                    const canSend = db.canSendToGroup(group.group_jid);
                    console.log(`  📊 canSendToGroup retornou: ${canSend}`);

                    if (canSend) {
                        try {
                            // Parse dados
                            const apiMetadata = this._parseMetadata(link.metadata);
                            const whatsappCopy = this._parseCopyText(link.copy_text);

                            // Garantir affiliate_link
                            if (!link.affiliate_link && !apiMetadata.affiliate_link) {
                                throw new Error('Link de afiliado não encontrado');
                            }

                            if (!apiMetadata.affiliate_link) {
                                apiMetadata.affiliate_link = link.affiliate_link;
                            }

                            // Normalizar dados
                            const normalizedData = DataNormalizer.normalize(
                                apiMetadata, 
                                whatsappCopy
                            );

                            if (!normalizedData.affiliate_link) {
                                normalizedData.affiliate_link = link.affiliate_link;
                            }

                            // Construir payload
                            const payload = MessageBuilder.buildPayload(normalizedData);

                            if (!payload || (!payload.text && !payload.caption)) {
                                throw new Error('Payload vazio ou inválido');
                            }

                            // Enviar
                            await this.sock.sendMessage(group.group_jid, payload);

                            // Registrar envio
                            db.run(
                                `INSERT INTO sent_links (tracked_link_id, target_group_jid, message)
                                 VALUES (?, ?, ?)`,
                                [link.id, group.group_jid, payload.caption || payload.text]
                            );

                            // Incrementar contador
                            db.incrementSentCount(group.group_jid);

                            console.log(`  ✅ Enviado com sucesso para ${group.group_name}`);

                            await new Promise(resolve => setTimeout(resolve, 500));

                        } catch (error) {
                            console.error(`  ❌ Erro ao enviar:`, error.message);
                            log.error(`Erro ao enviar para ${group.group_name}`, error);
                        }
                    } else {
                        this._logGroupStatus(group);
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            log.error('Erro ao enviar links', error);

        } finally {
            this.sending = false;
        }
    }

    // ==================== HELPERS ====================

    _parseMetadata(metadataStr) {
        try {
            if (!metadataStr) return {};
            const parsed = JSON.parse(metadataStr);
            return parsed;
        } catch (error) {
            log.error('Erro ao parsear metadata:', error.message);
            return {};
        }
    }

    _parseCopyText(copyTextStr) {
        try {
            if (!copyTextStr) return {};
            const parsed = JSON.parse(copyTextStr);
            return parsed;
        } catch (error) {
            log.error('Erro ao parsear copy_text:', error.message);
            return {};
        }
    }

    _logGroupStatus(group) {
        console.log(`  ⏸️ Grupo ${group.group_name} não pode receber envio agora`);

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

    // ==================== SCHEDULER ====================

    scheduleDailyReset() {
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const msUntilMidnight = midnight - now;

        setTimeout(() => {
            this.resetDailyCounters();
            setInterval(() => this.resetDailyCounters(), 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    resetDailyCounters() {
        db.run(`UPDATE target_groups SET sent_today = 0, last_reset = date('now')`);
        log.info('Contadores diários resetados');
        
        // Reset auth failure flag no início do dia
        this.authFailureDetected = false;
    }

    /**
     * Método para resetar manualmente a flag de auth failure
     * (chamar após atualizar cookies)
     */
    resetAuthFailureFlag() {
        this.authFailureDetected = false;
        log.info('✅ Flag de falha de autenticação resetada');
    }
}