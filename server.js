// web/server.js
import express from 'express';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { startBot, stopBot, getStatus } from './index.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const SESSION_PATH = path.resolve('./sessions');

/* =========================
   CONTROLES DO BOT
========================= */

app.post('/start', async (_, res) => {
    await startBot();
    res.json({ ok: true, message: 'Bot iniciado' });
});

app.post('/stop', async (_, res) => {
    await stopBot();
    res.json({ ok: true, message: 'Bot parado' });
});

/* =========================
   STATUS DETALHADO
========================= */

app.get('/status', async (_, res) => {
    const status = getStatus();

    let qrImage = null;
    if (status.qr) {
        qrImage = await QRCode.toDataURL(status.qr);
    }

    res.json({
        running: status.isRunning,
        hasQR: Boolean(status.qr),
        qr: qrImage,
        connection: status.connection
    });
});

/* =========================
   RESET DE SESSÃO
========================= */

app.post('/reset-session', async (_, res) => {
    const { isRunning } = getStatus();

    if (isRunning) {
        return res.status(400).json({
            ok: false,
            message: 'Pare o bot antes de apagar a sessão'
        });
    }

    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        }

        res.json({
            ok: true,
            message: 'Sessão removida com sucesso'
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            message: 'Erro ao remover sessão',
            error: err.message
        });
    }
});

app.listen(3000, () => {
    console.log('🌐 Web em http://localhost:3000');
});
