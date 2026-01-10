// index.js - VERSÃO CORRIGIDA
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { config } from './core/config.js';
import { log } from './core/logger.js';
import { Scheduler } from './services/scheduler.js';
import { LinkTracker } from './services/tracker.js';
import { handleAdminCommand } from './commands/admin.js';
import { TrackedGroupSyncService } from './services/trackedGroupSync.js';

// ==================== VARIÁVEIS DE CONTROLE GLOBAIS ====================
let sock = null;
let scheduler = null;
let isRunning = false;
let reconnectTimeout = null;
let lastQR = null;
let manualStop = false;
let connectionInfo = null;

// ==================== CONFIGURAÇÃO INICIAL ====================
// Configura handlers UMA ÚNICA VEZ no início
setupGlobalHandlers();

export async function startBot() {
    // Evita múltiplas instâncias
    manualStop = false;
    if (isRunning) {
        log.warn('⚠️ Bot já está em execução, ignorando nova inicialização');
        return;
    }
    
    isRunning = true;
    log.info('Iniciando bot...');
    
    try {
        // Configurar autenticação
        const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);
        
        // Criar socket do WhatsApp
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });
        
        // ==================== CONFIGURAR EVENTOS DO SOCKET ====================
        setupSocketEvents(sock, saveCreds);
        
	const groupSync = new TrackedGroupSyncService(sock);
        await groupSync.sync();

    } catch (error) {
        log.error('❌ Erro na inicialização do bot:', error);
        isRunning = false;
        scheduleRestart(5000);
    }
}

// ==================== CONFIGURAÇÃO DOS HANDLERS GLOBAIS ====================
function setupGlobalHandlers() {
    // Remove listeners antigos para evitar duplicação
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    
    // Configura handlers únicos
    process.once('SIGINT', handleShutdown);
    
    // Para erros, usa 'on' mas com lógica de restart controlada
    process.on('uncaughtException', (error) => {
        log.error('❌ Erro não tratado (uncaughtException):', error);
        // Não mata o processo imediatamente, tenta restart
        scheduleRestart(5000);
    });
    
    process.on('unhandledRejection', (error) => {
        log.error('❌ Promessa rejeitada não tratada (unhandledRejection):', error);
    });
    
    // Aumenta limite para evitar warnings (OPCIONAL mas útil)
    process.setMaxListeners(20);
}

// ==================== CONFIGURAÇÃO DOS EVENTOS DO SOCKET ====================
function setupSocketEvents(sock, saveCreds) {
    let qrShown = false;
    
    // EVENTO DE CONEXÃO
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Exibir QR Code usando qrcode-terminal
        if (qr && !qrShown) {
            lastQR = qr;
            qrShown = true;
            showQRCode(qr);
        }
        
        if (connection === 'open') {
            handleConnectionOpen(sock);
        } else if (connection === 'close') {
            handleConnectionClose(lastDisconnect);
        }
    });
    
    // Atualizar credenciais
    sock.ev.on('creds.update', saveCreds);
    
    // EVENTO DE MENSAGENS
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        // if (!msg.message || msg.key.fromMe) {
        //     console.log("Ignorando mensagens from me.")
        //     return
        // }
        
        const jid = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        
        // Log da mensagem recebida
        // log.info(`Mensagem de ${msg.pushName || 'Desconhecido'}: ${text.substring(0, 50)}...`);
        
        // 1. Rastrear links (sempre ativo)
        if (jid.endsWith('@g.us')) {
            const count = await LinkTracker.track(sock, msg);
            if (count > 0) {
                log.info(`✅ ${count} link(s) rastreado(s)`);
            }
        }
        
        // 2. Processar comandos (se bot ativo)
        if (config.botEnabled && text.startsWith(config.prefix)) {
            console.log(`Comando de ${msg.pushName || 'Desconhecido'}: ${text.substring(0, 50)}...`);
            const [cmd, ...args] = text.slice(config.prefix.length).trim().split(' ');
            
            if (cmd === 'admin') {
                await handleAdminCommand(sock, msg, args);
            }
        }
    });
    
    // EVENTO QUANDO BOT É ADICIONADO A GRUPO
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action === 'add' && participants.includes(sock.user.id)) {
            log.info(`✅ Bot adicionado ao grupo: ${id}`);
            
            setTimeout(async () => {
                try {
                    await sock.sendMessage(id, { 
                        text: '🤖 Bot de Afiliados ativo!\nUse #admin help para ver comandos.' 
                    });
                } catch (error) {
                    log.error('Erro ao enviar mensagem de boas-vindas:', error.message);
                }
            }, 2000);
        }
    });
}

// ==================== FUNÇÕES AUXILIARES ====================
function showQRCode(qr) {
    console.log('\n' + '═'.repeat(50));
    console.log('📱 ESCANEIE O QR CODE COM SEU WHATSAPP');
    console.log('═'.repeat(50) + '\n');
    qrcode.generate(qr, { small: true });
    console.log('\n' + '═'.repeat(50));
    console.log('📲 INSTRUÇÕES:');
    console.log('1. Abra o WhatsApp no celular');
    console.log('2. Toque em ⋮ (três pontos)');
    console.log('3. Escolha "Aparelhos conectados"');
    console.log('4. Toque em "Conectar um aparelho"');
    console.log('5. Aponte a câmera para o QR acima');
    console.log('═'.repeat(50) + '\n');
}

function handleConnectionOpen(sock) {
    console.log('\n✅ CONECTADO AO WHATSAPP!');
    console.log(`👤 Logado como: ${sock.user?.name || 'Usuário'}`);
    
    log.info('✅ Conectado ao WhatsApp');

    lastQR = null; 
    connectionInfo = {
        name: sock.user?.name || 'Usuário',
        id: sock.user?.id || null,
        phone: sock.user?.id?.split(':')[0] || null,
        connectedAt: new Date().toISOString()
    };
    
    // Limpa timeout de reconexão anterior se existir
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    // Iniciar agendador
    scheduler = new Scheduler(sock);
    setTimeout(() => {
        scheduler.start();
        log.info('Agendador iniciado');
    }, 30000);
}

function handleConnectionClose(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const error = lastDisconnect?.error;
    
    log.warn(`Conexão fechada. Status: ${statusCode || 'Desconhecido'}`);
    
    // Marca que não está mais rodando
    isRunning = false;

    if (manualStop) {
        log.info('Bot parado manualmente. Reconexão cancelada.');
        return;
    }
    
    // Verificar se precisa reconectar
    const shouldReconnect = 
        statusCode !== DisconnectReason.loggedOut &&
        !(error instanceof Boom && error.output?.statusCode === 403);
    
    if (shouldReconnect) {
        console.log('\n🔄 Tentando reconectar em 5 segundos...\n');
        scheduleRestart(5000);
    } else {
        console.log('\n❌ Desconectado permanentemente.');
        console.log('Remova a pasta "sessions/" e execute novamente.');
        process.exit(1);
    }
}

function scheduleRestart(delay) {
    // Cancela restart anterior se existir
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    
    reconnectTimeout = setTimeout(() => {
        log.info(`🔄 Reiniciando em ${delay/1000}s...`);
        startBot().catch(error => {
            log.error('Falha no restart:', error);
            // Backoff exponencial em caso de falha
            scheduleRestart(Math.min(delay * 2, 30000));
        });
    }, delay);
}

async function handleShutdown() {
    console.log('\n\n👋 Encerrando bot...');
    log.info('Encerrando bot...');

    connectionInfo = null;
    
    // Limpa timeout de reconexão
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    // Encerra socket se existir
    if (sock) {
        await sock.end();        
        sock = null;
    }
    scheduler = null
    
    
    isRunning = false;
    // process.exit(1);

}

export function getStatus() {
    return {
        isRunning,
        qr: lastQR,
        connection: connectionInfo
    };
}

export async function stopBot() {
    manualStop = true;
    handleShutdown();
}
    




// ==================== INICIAR O BOT ====================
console.log(`
╔══════════════════════════════════════════════╗
║         BOT DE AFILIADOS - WHATSAPP          ║
╚══════════════════════════════════════════════╝
`);

// startBot().catch(error => {
//     console.error('❌ ERRO FATAL AO INICIAR BOT:', error.message);
//     log.error('Erro fatal ao iniciar bot:', error);
//     process.exit(1);
// });
