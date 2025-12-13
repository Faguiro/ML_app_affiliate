// commands/admin.js
import { config } from '../core/config.js';
import { db } from '../database/db.js';
import { log } from '../core/logger.js';

export async function handleAdminCommand(sock, msg, args) {
    const jid = msg.key.remoteJid;
    
    // Verificar se é dono
    // if (!config.isOwner(msg.key.participant || jid)) {
    //     return sock.sendMessage(jid, { text: '❌ Apenas o dono pode usar este comando' });
    // }
    
    const command = args[0]?.toLowerCase() || '';
    
    switch (command) {
        case 'addgroup':
            return await addTargetGroup(sock, jid, args.slice(1));
            
        case 'removegroup':
            return await removeTargetGroup(sock, jid, args.slice(1));
            
        case 'groups':
            return await listGroups(sock, jid);
            
        case 'adddomain':
            return await addAffiliateDomain(sock, jid, args.slice(1));
            
        case 'domains':
            return await listDomains(sock, jid);
            
        case 'stats':
            return await showStats(sock, jid);
            
        case 'toggle':
            return await toggleBot(sock, jid, args.slice(1));
            
        default:
            return await showHelp(sock, jid);
    }
}

async function addTargetGroup(sock, jid, args) {
    try {
        const groupJid = args[0] === 'este' ? jid : args[0];
        
        if (!groupJid.endsWith('@g.us')) {
            return sock.sendMessage(jid, { text: '❌ É necessário um grupo válido' });
        }
        
        const metadata = await sock.groupMetadata(groupJid);
        
        db.run(
            `INSERT OR REPLACE INTO target_groups (group_jid, group_name)
             VALUES (?, ?)`,
            [groupJid, metadata.subject]
        );
        
        await sock.sendMessage(jid, {
            text: `✅ Grupo adicionado como destino:\n${metadata.subject}`
        });
        
    } catch (error) {
        log.error('Erro ao adicionar grupo', error);
        await sock.sendMessage(jid, { text: '❌ Erro ao adicionar grupo' });
    }
}

async function listGroups(sock, jid) {
    const groups = db.query(
        `SELECT group_name, group_jid, is_active, sent_today, daily_limit
         FROM target_groups ORDER BY group_name`
    );
    
    let message = `📋 *Grupos Destino (${groups.length})*\n\n`;
    
    groups.forEach((group, index) => {
        message += `${index + 1}. ${group.group_name}\n`;
        message += `   📍 ${group.group_jid}\n`;
        message += `   📊 ${group.sent_today}/${group.daily_limit} envios hoje\n`;
        message += `   ⚡ ${group.is_active ? '✅ Ativo' : '❌ Inativo'}\n\n`;
    });
    
    await sock.sendMessage(jid, { text: message });
}

async function addAffiliateDomain(sock, jid, args) {
    if (args.length < 2) {
        return sock.sendMessage(jid, {
            text: '❌ Uso: #admin adddomain <dominio> <codigo_afiliado>'
        });
    }
    
    const [domain, code] = args;
    
    db.run(
        `INSERT OR REPLACE INTO affiliate_domains (domain, affiliate_code)
         VALUES (?, ?)`,
        [domain, code]
    );
    
    await sock.sendMessage(jid, {
        text: `✅ Domínio adicionado:\n${domain} → ${code}`
    });
}

async function listDomains(sock, jid) {
    const domains = db.query(
        `SELECT domain, affiliate_code FROM affiliate_domains 
         WHERE is_active = 1 ORDER BY domain`
    );
    
    let message = `🌐 *Domínios Afiliados (${domains.length})*\n\n`;
    
    domains.forEach((domain, index) => {
        message += `${index + 1}. ${domain.domain}\n`;
        message += `   🔢 ${domain.affiliate_code}\n\n`;
    });
    
    await sock.sendMessage(jid, { text: message });
}

async function showStats(sock, jid) {
    const stats = db.get(`
        SELECT 
            (SELECT COUNT(*) FROM tracked_links) as total_links,
            (SELECT COUNT(*) FROM tracked_links WHERE status = 'ready') as ready_links,
            (SELECT COUNT(*) FROM sent_links) as sent_links,
            (SELECT COUNT(*) FROM target_groups WHERE is_active = 1) as active_groups,
            (SELECT COUNT(*) FROM affiliate_domains WHERE is_active = 1) as active_domains
    `);
    
    await sock.sendMessage(jid, {
        text: `📊 *Estatísticas do Sistema*\n\n` +
              `🔗 Links rastreados: ${stats.total_links}\n` +
              `✅ Links prontos: ${stats.ready_links}\n` +
              `📤 Links enviados: ${stats.sent_links}\n` +
              `👥 Grupos ativos: ${stats.active_groups}\n` +
              `🌐 Domínios ativos: ${stats.active_domains}`
    });
}

async function toggleBot(sock, jid, args) {
    const option = args[0];
    
    if (option === 'bot') {
        process.env.BOT_ENABLED = process.env.BOT_ENABLED === 'true' ? 'false' : 'true';
        await sock.sendMessage(jid, {
            text: `🤖 Bot ${process.env.BOT_ENABLED === 'true' ? '✅ ATIVADO' : '❌ DESATIVADO'}`
        });
    } else if (option === 'assistant') {
        process.env.ASSISTANT_ENABLED = process.env.ASSISTANT_ENABLED === 'true' ? 'false' : 'true';
        await sock.sendMessage(jid, {
            text: `🤖 Assistente ${process.env.ASSISTANT_ENABLED === 'true' ? '✅ ATIVADO' : '❌ DESATIVADO'}`
        });
    } else {
        await sock.sendMessage(jid, {
            text: '❌ Opção inválida. Use: bot ou assistant'
        });
    }
}

async function showHelp(sock, jid) {
    await sock.sendMessage(jid, {
        text: `⚙️ *Comandos Administrativos*\n\n` +
              `#admin addgroup <grupo|este> - Adiciona grupo destino\n` +
              `#admin removegroup <grupo> - Remove grupo destino\n` +
              `#admin groups - Lista grupos destino\n` +
              `#admin adddomain <dominio> <codigo> - Adiciona domínio afiliado\n` +
              `#admin domains - Lista domínios afiliados\n` +
              `#admin stats - Mostra estatísticas\n` +
              `#admin toggle <bot|assistant> - Liga/desliga funcionalidades`
    });
}