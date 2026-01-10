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

            let affected = 0;

            for (const [groupJid, group] of Object.entries(groups)) {
                if (targetGroups.has(groupJid)) continue;

                const result = db.run(
                    `
                    INSERT INTO tracked_groups (group_jid, group_name, is_active)
                    VALUES (?, ?, 1)
                    ON CONFLICT(group_jid)
                    DO UPDATE SET
                        group_name = excluded.group_name,
                        is_active = 1
                    `,
                    [groupJid, group.subject || null]
                );

                affected += result.changes;
                log.info(`[TrackedGroupSync] Grupo rastreado adicionado: ${group.subject} (${groupJid})`);
                await this.delay(1000);
            }

            log.info(`[TrackedGroupSync] Sincronização concluída. Registros afetados: ${affected}`);
        } catch (err) {
            log.error('[TrackedGroupSync] Erro na sincronização:', err);
        }
    }

    getTargetGroups() {
        const rows = db.query(
            `SELECT group_jid FROM target_groups WHERE is_active = 1`
        );

        return new Set(rows.map(r => r.group_jid));
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
