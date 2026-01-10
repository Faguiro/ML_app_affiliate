import { log } from '../core/logger.js'

/**
 * Lista grupos do bot e quantidade de membros
 * Execução segura, sem bloquear o fluxo principal
 */
export async function listBotGroups(sock) {
    try {
        log.info('🔍 Listando grupos do bot...')

        // Busca apenas grupos que o bot participa
        const groups = await sock.groupFetchAllParticipating()

        const result = Object.values(groups).map(group => ({
            jid: group.id,
            name: group.subject || 'Sem nome',
            members: group.participants?.length || 0
        }))

        log.info(`📊 Bot participa de ${result.length} grupo(s)`)

        for (const group of result) {
            log.info(`👥 ${group.name} | ${group.members} membros`)
        }

        return result
    } catch (error) {
        log.error('❌ Erro ao listar grupos:', error.message)
        return []
    }
}
