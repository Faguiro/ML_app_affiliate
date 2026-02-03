// server.js - VERSÃO OTIMIZADA COM MELHOR ENGENHARIA
import express from 'express';
import QRCode from 'qrcode';
import fs from 'fs/promises';
import path from 'path';
import { startBot, stopBot, getStatus } from './index.js';

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_PATH = path.resolve('./sessions');

// ==================== MIDDLEWARES ====================
app.use(express.json());
app.use(express.static('public'));

// Logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        message: err.message
    });
});

// ==================== VALIDAÇÕES ====================
function validateOperation(requiredState = null) {
    return (req, res, next) => {
        const status = getStatus();
        
        if (requiredState && status.state !== requiredState) {
            return res.status(400).json({
                success: false,
                error: 'invalid_state',
                message: `Operação requer estado: ${requiredState}. Estado atual: ${status.state}`,
                currentState: status.state
            });
        }
        
        next();
    };
}

// ==================== ROTAS DE CONTROLE ====================

/**
 * POST /start - Inicia o bot
 */
app.post('/start', async (req, res) => {
    try {
        const result = await startBot();
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.reason,
                message: getErrorMessage(result.reason)
            });
        }
        
        res.json({
            success: true,
            message: 'Bot iniciado com sucesso',
            status: getStatus()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'start_failed',
            message: error.message
        });
    }
});

/**
 * POST /stop - Para o bot
 */
app.post('/stop', async (req, res) => {
    try {
        const result = await stopBot();
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.reason,
                message: getErrorMessage(result.reason)
            });
        }
        
        res.json({
            success: true,
            message: 'Bot parado com sucesso',
            status: getStatus()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'stop_failed',
            message: error.message
        });
    }
});

/**
 * POST /restart - Reinicia o bot
 */
app.post('/restart', async (req, res) => {
    try {
        const status = getStatus();
        
        // Para o bot se estiver rodando
        if (status.isRunning) {
            const stopResult = await stopBot();
            if (!stopResult.success) {
                return res.status(400).json({
                    success: false,
                    error: 'stop_failed',
                    message: 'Falha ao parar bot antes de reiniciar'
                });
            }
            
            // Aguarda um momento para garantir limpeza completa
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Inicia novamente
        const startResult = await startBot();
        
        if (!startResult.success) {
            return res.status(400).json({
                success: false,
                error: startResult.reason,
                message: 'Falha ao iniciar bot após parada'
            });
        }
        
        res.json({
            success: true,
            message: 'Bot reiniciado com sucesso',
            status: getStatus()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'restart_failed',
            message: error.message
        });
    }
});

// ==================== ROTAS DE STATUS ====================

/**
 * GET /status - Status detalhado do bot
 */
app.get('/status', async (req, res) => {
    try {
        const status = getStatus();
        
        // Gerar QR Code como imagem se disponível
        let qrImage = null;
        if (status.qr && !status.qrExpired) {
            qrImage = await QRCode.toDataURL(status.qr);
        }
        
        res.json({
            success: true,
            state: status.state,
            running: status.isRunning,
            qr: {
                available: Boolean(status.qr && !status.qrExpired),
                image: qrImage,
                expired: status.qrExpired,
                attempts: status.qrAttempts
            },
            connection: status.connection,
            features: {
                scheduler: status.hasScheduler
            },
            timestamp: status.timestamp
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'status_error',
            message: error.message
        });
    }
});

/**
 * GET /health - Health check simples
 */
app.get('/health', (req, res) => {
    const status = getStatus();
    
    const isHealthy = status.state !== 'ERROR';
    
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        state: status.state,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==================== ROTAS DE SESSÃO ====================

/**
 * GET /session/exists - Verifica se existe sessão salva
 */
app.get('/session/exists', async (req, res) => {
    try {
        const exists = await sessionExists();
        
        res.json({
            success: true,
            exists,
            path: SESSION_PATH
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'check_failed',
            message: error.message
        });
    }
});

/**
 * DELETE /session - Remove sessão (requer bot parado)
 */
app.delete('/session', async (req, res) => {
    try {
        const status = getStatus();
        
        // Validar que bot está parado
        if (status.isRunning || status.state === 'STOPPING') {
            return res.status(400).json({
                success: false,
                error: 'bot_running',
                message: 'Pare o bot antes de remover a sessão',
                currentState: status.state
            });
        }
        
        // Remover sessão
        const removed = await removeSession();
        
        if (!removed) {
            return res.status(404).json({
                success: false,
                error: 'session_not_found',
                message: 'Nenhuma sessão encontrada para remover'
            });
        }
        
        res.json({
            success: true,
            message: 'Sessão removida com sucesso'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'delete_failed',
            message: error.message
        });
    }
});

/**
 * POST /session/reset - Para bot, remove sessão e reinicia
 */
app.post('/session/reset', async (req, res) => {
    try {
        const status = getStatus();
        
        // Parar bot se estiver rodando
        if (status.isRunning) {
            const stopResult = await stopBot();
            if (!stopResult.success) {
                return res.status(400).json({
                    success: false,
                    error: 'stop_failed',
                    message: 'Falha ao parar bot'
                });
            }
            
            // Aguarda limpeza completa
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        // Remover sessão
        await removeSession();
        
        // Aguarda um momento
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reiniciar bot
        const startResult = await startBot();
        
        res.json({
            success: true,
            message: 'Sessão resetada e bot reiniciado',
            botStarted: startResult.success,
            status: getStatus()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'reset_failed',
            message: error.message
        });
    }
});

// ==================== FUNÇÕES AUXILIARES ====================

async function sessionExists() {
    try {
        await fs.access(SESSION_PATH);
        return true;
    } catch {
        return false;
    }
}

async function removeSession() {
    try {
        const exists = await sessionExists();
        if (!exists) return false;
        
        await fs.rm(SESSION_PATH, { recursive: true, force: true });
        console.log('✅ Sessão removida:', SESSION_PATH);
        return true;
    } catch (error) {
        console.error('❌ Erro ao remover sessão:', error);
        throw error;
    }
}

function getErrorMessage(errorCode) {
    const messages = {
        'already_running': 'Bot já está em execução',
        'already_stopped': 'Bot já está parado',
        'stopping_in_progress': 'Bot está sendo parado, aguarde',
        'initialization_error': 'Erro ao inicializar bot',
        'invalid_state': 'Estado do bot não permite esta operação'
    };
    
    return messages[errorCode] || 'Erro desconhecido';
}

// ==================== INICIALIZAÇÃO DO SERVIDOR ====================

const server = app.listen(PORT, async () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║     🌐 API WEB INICIADA                       ║
║     📍 http://localhost:${PORT}                   ║
║                                               ║
║     ENDPOINTS:                                ║
║     POST   /start          - Iniciar bot      ║
║     POST   /stop           - Parar bot        ║
║     POST   /restart        - Reiniciar bot    ║
║     GET    /status         - Status detalhado ║
║     GET    /health         - Health check     ║
║     GET    /session/exists - Verificar sessão ║
║     DELETE /session        - Remover sessão   ║
║     POST   /session/reset  - Resetar tudo     ║
╚═══════════════════════════════════════════════╝
    `);
    // --- LÓGICA DE AUTO-START ADICIONADA AQUI ---
    try {
        console.log('🔄 Auto-início configurado: Tentando iniciar o bot...');
        const result = await startBot();
        
        if (result.success) {
            console.log('✅ Bot iniciado automaticamente com sucesso!');
        } else {
            console.warn(`⚠️ O bot não pôde iniciar automaticamente. Razão: ${result.reason}`);
        }
    } catch (error) {
        console.error('❌ Erro fatal ao tentar auto-iniciar o bot:', error);
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n👋 Recebido SIGTERM, encerrando servidor...');
    
    server.close(async () => {
        console.log('✅ Servidor HTTP fechado');
        
        const status = getStatus();
        if (status.isRunning) {
            await stopBot();
        }
        
        process.exit(0);
    });
});

export default app;