// bot/bot.js
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';

let sock = null;
let isRunning = false;
let lastQR = null;

export async function startBot() {
    if (isRunning) return;
    console.log('Iniciando bot...');

    const { state, saveCreds } = await useMultiFileAuthState('./sessions');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });
    if (!sock) {
        console.log('Erro ao criar o socket do WhatsApp');
        return;
    }

    console.log('Bot iniciado.');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
            lastQR = qr;
            console.log('📱 QR recebido');
        }

        if (connection === 'open') {
            isRunning = true;
            lastQR = null;
            console.log('✅ Bot conectado');
        }

        if (connection === 'close') {
            isRunning = false;
            console.log('❌ Bot desconectado');
        }
    });
}

export async function stopBot() {
    if (!sock) return;

    await sock.logout();
    sock = null;
    isRunning = false;
    lastQR = null;
    console.log('Bot parado.');
}

export function getStatus() {
    return {
        isRunning,
        qr: lastQR
    };
}
