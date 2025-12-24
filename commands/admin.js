// commands/admin.js
import { config } from '../core/config.js';
import { db } from '../database/db.js';
import { log } from '../core/logger.js';

export async function handleAdminCommand(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    
    // Extrair argumentos completos da mensagem original
    const fullArgs = messageText.split(' ').slice(1);
    const command = fullArgs[0]?.toLowerCase() || '';
    const commandArgs = fullArgs.slice(1);
    
    // Log para debug (opcional)
    log.info(`Comando admin: "${messageText}"`, { command, commandArgs });
    
    // Verificar se é dono
    // if (!config.isOwner(msg.key.participant || jid)) {
    //     return sock.sendMessage(jid, { text: '❌ Apenas o dono pode usar este comando' });
    // }
    
    switch (command) {
        case 'addgroup':
            return await addTargetGroup(sock, jid, commandArgs);
            
        case 'removegroup':
            return await removeTargetGroup(sock, jid, commandArgs);
            
        case 'groups':
            return await listGroups(sock, jid);
            
        case 'adddomain':
            return await addAffiliateDomain(sock, jid, commandArgs);
            
        case 'domains':
            return await listDomains(sock, jid);
            
        case 'stats':
            return await showStats(sock, jid);
            
        case 'toggle':
            return await toggleBot(sock, jid, commandArgs);
            
        default:
            return await showHelp(sock, jid);
    }
}

async function addTargetGroup(sock, jid, args) {
    try {
        if (args.length === 0) {
            return sock.sendMessage(jid, { 
                text: '❌ Uso: #admin addgroup <grupo_jid|este>\n\n' +
                      'Exemplos:\n' +
                      '#admin addgroup este\n' +
                      '#admin addgroup 5511999999999-1584040416@g.us'
            });
        }
        
        const groupJid = args[0].toLowerCase() === 'este' ? jid : args[0];
        
        if (!groupJid.endsWith('@g.us')) {
            return sock.sendMessage(jid, { 
                text: '❌ É necessário um grupo válido (terminando em @g.us)'
            });
        }
        
        const metadata = await sock.groupMetadata(groupJid);
        
        db.run(
            `INSERT OR REPLACE INTO target_groups (group_jid, group_name)
             VALUES (?, ?)`,
            [groupJid, metadata.subject]
        );
        
        await sock.sendMessage(jid, {
            text: `✅ Grupo adicionado como destino:\n` +
                  `📝 *Nome:* ${metadata.subject}\n` +
                  `📍 *JID:* ${groupJid}`
        });
        
        log.info(`Grupo adicionado: ${metadata.subject} (${groupJid})`);
        
    } catch (error) {
        log.error('Erro ao adicionar grupo', error);
        await sock.sendMessage(jid, { 
            text: '❌ Erro ao adicionar grupo. Verifique:\n' +
                  '1. Se o bot está no grupo\n' +
                  '2. Se o JID está correto\n' +
                  '3. Se é realmente um grupo'
        });
    }
}

async function removeTargetGroup(sock, jid, args) {
    try {
        // Se não há argumentos, mostrar ajuda com lista de grupos
        if (args.length === 0) {
            const groups = db.query(`SELECT group_jid, group_name FROM target_groups ORDER BY group_name`);
            
            if (groups.length === 0) {
                return sock.sendMessage(jid, { text: '📭 Nenhum grupo cadastrado.' });
            }
            
            let message = `📋 *Grupos Disponíveis para Remover*\n\n`;
            groups.forEach((group, index) => {
                message += `${index + 1}. ${group.group_name}\n`;
                message += `   📍 ${group.group_jid}\n\n`;
            });
            
            message += `\n📝 *Como remover:*\n`;
            message += `#admin removegroup <JID_do_grupo>\n`;
            message += `Ou: #admin removegroup este (para remover o grupo atual)\n`;
            message += `Ex: #admin removegroup 5521997757028-1608758202@g.us`;
            
            return sock.sendMessage(jid, { text: message });
        }
        
        // Determinar qual grupo remover
        let groupJid;
        
        if (args[0].toLowerCase() === 'este') {
            // Verificar se é um grupo
            if (!jid.endsWith('@g.us')) {
                return sock.sendMessage(jid, { 
                    text: '❌ O comando "este" só funciona em grupos.'
                });
            }
            groupJid = jid;
        } else {
            // Usar o JID fornecido
            groupJid = args[0];
            
            // Verificar formato do JID
            if (!groupJid.endsWith('@g.us')) {
                // Tentar formatar se for apenas números
                if (/^\d+-\d+$/.test(groupJid)) {
                    groupJid = `${groupJid}@g.us`;
                } else {
                    return sock.sendMessage(jid, { 
                        text: `❌ Formato de JID inválido: ${groupJid}\n` +
                              `Formato correto: 5521997757028-1608758202@g.us`
                    });
                }
            }
        }
        
        // Verificar se o grupo existe
        const groupInfo = db.get(
            `SELECT group_name FROM target_groups WHERE group_jid = ?`,
            [groupJid]
        );
        
        if (!groupInfo) {
            return sock.sendMessage(jid, { 
                text: `❌ Grupo não encontrado:\n${groupJid}\n\n` +
                      `Use #admin groups para ver a lista de grupos cadastrados.`
            });
        }
        
        // Pedir confirmação se não tiver flag -y
        if (!args.includes('-y')) {
            return sock.sendMessage(jid, {
                text: `⚠️ *Confirmar Remoção*\n\n` +
                      `📝 *Grupo:* ${groupInfo.group_name}\n` +
                      `📍 *JID:* ${groupJid}\n\n` +
                      `Tem certeza que deseja remover este grupo?\n\n` +
                      `✅ Para confirmar:\n` +
                      `#admin removegroup ${groupJid} -y\n\n` +
                      `❌ Para cancelar, ignore esta mensagem.`
            });
        }
        
        // Remover o grupo
        db.run(`DELETE FROM target_groups WHERE group_jid = ?`, [groupJid]);
        
        // Limpar histórico relacionado
        db.run(`DELETE FROM sent_links WHERE target_group = ?`, [groupJid]);
        
        await sock.sendMessage(jid, {
            text: `✅ *Grupo Removido*\n\n` +
                  `📝 *Nome:* ${groupInfo.group_name}\n` +
                  `📍 *JID:* ${groupJid}\n\n` +
                  `🗑️ Todos os registros foram removidos.`
        });
        
        log.info(`Grupo removido: ${groupInfo.group_name} (${groupJid})`);
        
    } catch (error) {
        log.error('Erro ao remover grupo:', error);
        await sock.sendMessage(jid, { 
            text: `❌ Erro ao remover grupo:\n${error.message}\n\n` +
                  `Verifique se o JID está correto e se o grupo existe.`
        });
    }
}

async function listGroups(sock, jid) {
    try {
        const groups = db.query(
            `SELECT group_name, group_jid, is_active, sent_today, daily_limit
             FROM target_groups ORDER BY group_name`
        );
        
        if (groups.length === 0) {
            return sock.sendMessage(jid, { 
                text: '📭 Nenhum grupo cadastrado como destino.'
            });
        }
        
        let message = `📋 *Grupos Destino (${groups.length})*\n\n`;
        
        groups.forEach((group, index) => {
            const shortJid = group.group_jid.split('@')[0];
            message += `${index + 1}. *${group.group_name}*\n`;
            message += `   📍 ${shortJid}\n`;
            message += `   📊 ${group.sent_today || 0}/${group.daily_limit || 10} envios hoje\n`;
            message += `   ⚡ ${group.is_active ? '✅ Ativo' : '❌ Inativo'}\n\n`;
        });
        
        message += `\n📝 *Para remover:* #admin removegroup <JID>\n`;
        message += `Ex: #admin removegroup ${groups[0].group_jid}`;
        
        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        log.error('Erro ao listar grupos:', error);
        await sock.sendMessage(jid, { 
            text: '❌ Erro ao listar grupos'
        });
    }
}

async function addAffiliateDomain(sock, jid, args) {
    if (args.length < 2) {
        return sock.sendMessage(jid, {
            text: '❌ Uso: #admin adddomain <dominio> <codigo_afiliado>\n\n' +
                  'Exemplo: #admin adddomain exemplo.com AF12345'
        });
    }
    
    const [domain, code] = args;
    
    // Validar domínio
    if (!domain.includes('.') || domain.length < 4) {
        return sock.sendMessage(jid, {
            text: '❌ Domínio inválido. Use um domínio válido como: exemplo.com'
        });
    }
    
    try {
        db.run(
            `INSERT OR REPLACE INTO affiliate_domains (domain, affiliate_code, is_active)
             VALUES (?, ?, 1)`,
            [domain, code]
        );
        
        await sock.sendMessage(jid, {
            text: `✅ Domínio afiliado adicionado:\n\n` +
                  `🌐 *Domínio:* ${domain}\n` +
                  `🔢 *Código:* ${code}\n\n` +
                  `Os links deste domínio serão convertidos automaticamente.`
        });
        
        log.info(`Domínio adicionado: ${domain} -> ${code}`);
        
    } catch (error) {
        log.error('Erro ao adicionar domínio:', error);
        await sock.sendMessage(jid, {
            text: '❌ Erro ao adicionar domínio afiliado'
        });
    }
}

async function listDomains(sock, jid) {
    try {
        const domains = db.query(
            `SELECT domain, affiliate_code, is_active FROM affiliate_domains 
             ORDER BY domain`
        );
        
        if (domains.length === 0) {
            return sock.sendMessage(jid, { 
                text: '🌐 Nenhum domínio afiliado cadastrado.'
            });
        }
        
        let message = `🌐 *Domínios Afiliados (${domains.length})*\n\n`;
        
        domains.forEach((domain, index) => {
            message += `${index + 1}. ${domain.domain}\n`;
            message += `   🔢 Código: ${domain.affiliate_code}\n`;
            message += `   ⚡ ${domain.is_active ? '✅ Ativo' : '❌ Inativo'}\n\n`;
        });
        
        message += `\n📝 Para adicionar: #admin adddomain <dominio> <codigo>`;
        
        await sock.sendMessage(jid, { text: message });
    } catch (error) {
        log.error('Erro ao listar domínios:', error);
        await sock.sendMessage(jid, { 
            text: '❌ Erro ao listar domínios'
        });
    }
}

async function showStats(sock, jid) {
    try {
        const stats = db.get(`
            SELECT 
                (SELECT COUNT(*) FROM tracked_links) as total_links,
                (SELECT COUNT(*) FROM tracked_links WHERE status = 'ready') as ready_links,
                (SELECT COUNT(*) FROM sent_links) as sent_links,
                (SELECT COUNT(*) FROM target_groups WHERE is_active = 1) as active_groups,
                (SELECT COUNT(*) FROM affiliate_domains WHERE is_active = 1) as active_domains
        `) || {};
        
        // Estatísticas adicionais
        const today = new Date().toISOString().split('T')[0];
        const todayStats = db.get(`
            SELECT COUNT(*) as sent_today 
            FROM sent_links 
            WHERE DATE(sent_at) = ?
        `, [today]) || { sent_today: 0 };
        
        await sock.sendMessage(jid, {
            text: `📊 *Estatísticas do Sistema*\n\n` +
                  `🔗 *Links rastreados:* ${stats.total_links || 0}\n` +
                  `✅ *Links prontos:* ${stats.ready_links || 0}\n` +
                  `📤 *Total enviados:* ${stats.sent_links || 0}\n` +
                  `📅 *Enviados hoje:* ${todayStats.sent_today}\n` +
                  `👥 *Grupos ativos:* ${stats.active_groups || 0}\n` +
                  `🌐 *Domínios ativos:* ${stats.active_domains || 0}\n\n` +
                  `⏰ ${new Date().toLocaleString('pt-BR')}`
        });
    } catch (error) {
        log.error('Erro ao mostrar estatísticas:', error);
        await sock.sendMessage(jid, { 
            text: '❌ Erro ao carregar estatísticas'
        });
    }
}

async function toggleBot(sock, jid, args) {
    const option = args[0]?.toLowerCase();
    
    if (option === 'bot') {
        process.env.BOT_ENABLED = process.env.BOT_ENABLED === 'true' ? 'false' : 'true';
        await sock.sendMessage(jid, {
            text: `🤖 Bot ${process.env.BOT_ENABLED === 'true' ? '✅ ATIVADO' : '❌ DESATIVADO'}`
        });
        log.info(`Bot ${process.env.BOT_ENABLED === 'true' ? 'ativado' : 'desativado'}`);
    } else if (option === 'assistant') {
        process.env.ASSISTANT_ENABLED = process.env.ASSISTANT_ENABLED === 'true' ? 'false' : 'true';
        await sock.sendMessage(jid, {
            text: `🤖 Assistente ${process.env.ASSISTANT_ENABLED === 'true' ? '✅ ATIVADO' : '❌ DESATIVADO'}`
        });
        log.info(`Assistente ${process.env.ASSISTANT_ENABLED === 'true' ? 'ativado' : 'desativado'}`);
    } else {
        await sock.sendMessage(jid, {
            text: '❌ Opção inválida. Use:\n\n' +
                  '#admin toggle bot\n' +
                  '#admin toggle assistant'
        });
    }
}

async function showHelp(sock, jid) {
    await sock.sendMessage(jid, {
        text: `⚙️ *Comandos Administrativos*\n\n` +
              `📋 *Grupos:*\n` +
              `#admin addgroup <grupo|este> - Adiciona grupo destino\n` +
              `#admin removegroup <grupo> - Remove grupo destino\n` +
              `#admin groups - Lista grupos destino\n\n` +
              `🌐 *Domínios:*\n` +
              `#admin adddomain <dominio> <codigo> - Adiciona domínio afiliado\n` +
              `#admin domains - Lista domínios afiliados\n\n` +
              `📊 *Sistema:*\n` +
              `#admin stats - Mostra estatísticas\n` +
              `#admin toggle <bot|assistant> - Liga/desliga funcionalidades\n\n` +
              `📝 *Exemplos:*\n` +
              `#admin addgroup este\n` +
              `#admin removegroup 5521997757028-1608758202@g.us -y\n` +
              `#admin adddomain exemplo.com AF12345`
    });
}