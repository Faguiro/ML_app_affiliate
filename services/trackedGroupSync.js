import { db } from '../database/db.js';
import { log } from '../core/logger.js';

export class TrackedGroupSyncService {
    constructor(sock) {
        this.sock = sock;
    }

    async sync() {
        try {
            log.info('[TrackedGroupSync] Iniciando sincronização');

            // ⚠️ Proteção contra queda do Baileys
            await this.delay(8000);

            const groups = await this.sock.groupFetchAllParticipating();

            const targetGroups = this.getTargetGroups();
            const existingTrackedGroups = this.getExistingTrackedGroups();

            let inserted = 0;
            let skipped = 0;

            for (const [groupJid, group] of Object.entries(groups)) {
                // Pular se for grupo de envio (target group)
                if (targetGroups.has(groupJid)) {
                    log.debug(`[TrackedGroupSync] Ignorando grupo de envio: ${group.subject}`);
                    continue;
                }

                // Pular se já existe na tabela tracked_groups
                if (existingTrackedGroups.has(groupJid)) {
                    log.debug(`[TrackedGroupSync] Grupo já existe: ${group.subject}`);
                    skipped++;
                    continue;
                }

                // SÓ INSERE SE NÃO EXISTIR
                try {
                    const result = db.run(
                        `INSERT INTO tracked_groups (group_jid, group_name, is_active)
                         VALUES (?, ?, 1)`,
                        [groupJid, group.subject || 'Sem nome']
                    );

                    if (result.changes > 0) {
                        inserted++;
                        log.info(`[TrackedGroupSync] ✅ Novo grupo rastreado: ${group.subject} (${groupJid})`);
                    }

                    // Pequeno delay para evitar sobrecarga
                    await this.delay(500);
                    
                } catch (error) {
                    if (error.message.includes('UNIQUE constraint failed')) {
                        log.debug(`[TrackedGroupSync] Grupo já existe (violação de constraint): ${group.subject}`);
                        skipped++;
                    } else {
                        log.error(`[TrackedGroupSync] Erro ao inserir grupo ${group.subject}:`, error);
                    }
                }
            }

            log.info(`[TrackedGroupSync] Sincronização concluída. Inseridos: ${inserted}, Pulados: ${skipped}`);
            
        } catch (err) {
            log.error('[TrackedGroupSync] Erro na sincronização:', err);
        }
    }

    getTargetGroups() {
        try {
            const rows = db.query(
                `SELECT group_jid FROM target_groups WHERE is_active = 1`
            );
            return new Set(rows.map(r => r.group_jid));
        } catch (error) {
            log.error('[TrackedGroupSync] Erro ao buscar target groups:', error);
            return new Set();
        }
    }

    getExistingTrackedGroups() {
        try {
            const rows = db.query(
                `SELECT group_jid FROM tracked_groups`
            );
            return new Set(rows.map(r => r.group_jid));
        } catch (error) {
            log.error('[TrackedGroupSync] Erro ao buscar grupos rastreados:', error);
            return new Set();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}