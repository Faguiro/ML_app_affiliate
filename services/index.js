// index.js - VERSÃO OTIMIZADA COM MELHOR ENGENHARIA
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import { config } from "./core/config.js";
import { log } from "./core/logger.js";
import { Scheduler } from "./services/scheduler.js";
import { LinkTracker } from "./services/tracker.js";
import { handleAdminCommand } from "./commands/admin.js";
import { TrackedGroupSyncService } from "./services/trackedGroupSync.js";

// ==================== ENUMS PARA ESTADOS ====================
const BotState = {
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  STOPPING: "STOPPING",
  ERROR: "ERROR",
};

// ==================== CLASSE DE GERENCIAMENTO DO BOT ====================
class WhatsAppBot {
  constructor() {
    this.state = BotState.STOPPED;
    this.sock = null;
    this.scheduler = null;
    this.groupSync = null;
    this.reconnectTimeout = null;
    this.qrData = {
      code: null,
      expiresAt: null,
      attemptCount: 0,
    };
    this.connectionInfo = null;
    this.eventCleanupFns = [];
    this.startMutex = false;
    this.stopMutex = false;

    this.setupGlobalHandlers();
  }

  // ==================== MUTEX PARA PREVENIR RACE CONDITIONS ====================
  async withMutex(mutexName, operation) {
    if (this[mutexName]) {
      throw new Error(`Operação já em andamento: ${mutexName}`);
    }

    this[mutexName] = true;
    try {
      return await operation();
    } finally {
      this[mutexName] = false;
    }
  }

  // ==================== INICIALIZAÇÃO ====================
  async start() {
    return this.withMutex("startMutex", async () => {
      if (
        this.state === BotState.CONNECTED ||
        this.state === BotState.STARTING
      ) {
        log.warn("⚠️ Bot já está iniciado ou iniciando");
        return { success: false, reason: "already_running" };
      }

      if (this.state === BotState.STOPPING) {
        log.warn("⚠️ Bot está sendo parado, aguarde");
        return { success: false, reason: "stopping_in_progress" };
      }

      this.state = BotState.STARTING;
      log.info("🚀 Iniciando bot...");

      try {
        // Limpar reconexão anterior se existir
        this.clearReconnectTimeout();

        // Configurar autenticação
        const { state, saveCreds } = await useMultiFileAuthState(
          config.sessionPath,
        );

        // Criar socket
        this.sock = makeWASocket({
          auth: state,
          logger: pino({ level: "silent" }),
          printQRInTerminal: true,
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 60000,
          keepAliveIntervalMs: 30000,
        });

        // Configurar eventos
        this.setupSocketEvents(saveCreds);

        this.state = BotState.CONNECTING;
        log.info("⏳ Aguardando conexão...");

        return { success: true };
      } catch (error) {
        log.error("❌ Erro na inicialização:", error);
        this.state = BotState.ERROR;
        this.scheduleRestart(5000);
        return {
          success: false,
          reason: "initialization_error",
          error: error.message,
        };
      }
    });
  }

  // ==================== CONFIGURAÇÃO DE EVENTOS ====================
  setupSocketEvents(saveCreds) {
    // Limpar listeners anteriores
    this.cleanupEventListeners();

    // Connection Update
    const connectionHandler = (update) => this.handleConnectionUpdate(update);
    this.sock.ev.on("connection.update", connectionHandler);
    this.eventCleanupFns.push(() =>
      this.sock.ev.off("connection.update", connectionHandler),
    );

    // Credentials Update
    const credsHandler = saveCreds;
    this.sock.ev.on("creds.update", credsHandler);
    this.eventCleanupFns.push(() =>
      this.sock.ev.off("creds.update", credsHandler),
    );

    // Messages
    const messagesHandler = (m) => this.handleMessages(m);
    this.sock.ev.on("messages.upsert", messagesHandler);
    this.eventCleanupFns.push(() =>
      this.sock.ev.off("messages.upsert", messagesHandler),
    );

    // Group Participants
    const groupHandler = (u) => this.handleGroupUpdate(u);
    this.sock.ev.on("group-participants.update", groupHandler);
    this.eventCleanupFns.push(() =>
      this.sock.ev.off("group-participants.update", groupHandler),
    );
  }

  // ==================== HANDLER DE CONEXÃO ====================
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // Gerenciar QR Code
    if (qr) {
      this.qrData.code = qr;
      this.qrData.expiresAt = Date.now() + 60000; // 60s
      this.qrData.attemptCount++;

      log.info(`📱 QR Code gerado (tentativa ${this.qrData.attemptCount})`);

      if (config.printQRInTerminal !== false) {
        this.displayQRCode(qr);
      }

      // Timeout para QR expirado
      setTimeout(() => {
        if (this.qrData.code === qr && this.state !== BotState.CONNECTED) {
          this.qrData.code = null;
          log.warn("⏰ QR Code expirado");
        }
      }, 60000);
    }

    // Conexão estabelecida
    if (connection === "open") {
      this.handleConnectionOpen();
    }

    // Conexão fechada
    if (connection === "close") {
      this.handleConnectionClose(lastDisconnect);
    }
  }

  // ==================== CONEXÃO ABERTA ====================
  async handleConnectionOpen() {
    this.state = BotState.CONNECTED;
    this.qrData = { code: null, expiresAt: null, attemptCount: 0 };

    this.connectionInfo = {
      name: this.sock.user?.name || "Usuário",
      id: this.sock.user?.id || null,
      phone: this.sock.user?.id?.split(":")[0] || null,
      connectedAt: new Date().toISOString(),
    };

    log.info(
      `✅ Conectado como: ${this.connectionInfo.name} (${this.connectionInfo.phone})`,
    );

    // Limpar timeout de reconexão
    this.clearReconnectTimeout();

    // Sincronizar grupos rastreados
    try {
      // this.groupSync = new TrackedGroupSyncService(this.sock);
      // await this.groupSync.sync();
      log.info("✅ Grupos sincronizados");
    } catch (error) {
      log.error("⚠️ Erro ao sincronizar grupos:", error.message);
    }

    // Iniciar scheduler (com delay para estabilidade)
    setTimeout(() => {
      this.scheduler = new Scheduler(this.sock);
      this.scheduler.start();
      log.info("✅ Scheduler iniciado");
    }, 5000);
  }

  // ==================== CONEXÃO FECHADA ====================
  handleConnectionClose(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const error = lastDisconnect?.error;

    log.warn(`🔌 Conexão fechada. Status: ${statusCode || "Desconhecido"}`);

    // Limpar recursos
    this.cleanup(false);

    // Verificar se deve reconectar
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
    const isForbidden =
      error instanceof Boom && error.output?.statusCode === 403;
    const shouldReconnect =
      !isLoggedOut && !isForbidden && this.state !== BotState.STOPPING;

    if (shouldReconnect) {
      this.state = BotState.CONNECTING;
      log.info("🔄 Agendando reconexão...");
      this.scheduleRestart(5000);
    } else {
      this.state = BotState.STOPPED;

      if (isLoggedOut || isForbidden) {
        log.error(
          '❌ Sessão inválida. Remova a pasta "sessions/" e faça login novamente.',
        );
      }
    }
  }

  // ==================== HANDLER DE MENSAGENS ====================
  async handleMessages({ messages }) {
    if (this.state !== BotState.CONNECTED) return;

    const msg = messages[0];
    if (!msg?.message) return;

    const jid = msg.key.remoteJid;

    function unwrapMessage(message) {
      if (!message) return null;

      if (message.ephemeralMessage?.message) {
        return unwrapMessage(message.ephemeralMessage.message);
      }

      if (message.viewOnceMessage?.message) {
        return unwrapMessage(message.viewOnceMessage.message);
      }

      if (message.viewOnceMessageV2?.message) {
        return unwrapMessage(message.viewOnceMessageV2.message);
      }

      return message;
    }

    const messageContent = unwrapMessage(msg.message);

    // Ignora eventos técnicos
    if (
      messageContent.senderKeyDistributionMessage ||
      messageContent.reactionMessage
    )
      return;

    const text =
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      messageContent.imageMessage?.caption ||
      messageContent.videoMessage?.caption ||
      messageContent.documentMessage?.caption ||
      "";

    if (!text) return;

    // console.log(`\n📩 Texto capturado do grupo: ${jid}\n ${text}\n` );

    const isFromMe = msg.key.fromMe;

    // Log
    // if (!isFromMe) {
    //     log.info(`📨 ${msg.pushName || 'Desconhecido'}: ${text.substring(0, 100)}`);
    // }

    // Rastrear links em grupos
    if (jid.endsWith("@g.us") && !isFromMe) {
      if (
        jid === "120363405712178338@g.us" ||
        jid === "5521997757028-1608758202@g.us"
      ) {
        console.log("\n--------------------------------------------");
        console.log("Nova mensagem em grupo:", jid);
        console.log("Autor:", msg.pushName || "Desconhecido");
        console.log("Conteúdo:", text);
        console.log("--------------------------------------------\n");
        if (text.length < 10) {
          console.log(
            "exibir msg completa:\n",
            JSON.stringify(messages, null, 2),
          );
        }
      }

      try {
        const count = await LinkTracker.track(this.sock, msg, text);
        if (count > 0) {
          log.info(`🔗 ${count} link(s) rastreado(s)`);
          console.log("\n--------------------------------------------\n");
          console.log("Nova mensagem em grupo:", jid);
          console.log("Autor:", msg.pushName || "Desconhecido");
          // console.log("Conteúdo:", text);
          console.log("--------------------------------------------\n");
          // console.log("exibir msg completa:\n", JSON.stringify(messages, null, 2));

        }
      } catch (error) {
        log.error("Erro ao rastrear links:", error.message);
      }
    }

    // Processar comandos
    if (config.botEnabled && text.startsWith(config.prefix) && !isFromMe) {
      const [cmd, ...args] = text.slice(config.prefix.length).trim().split(" ");

      if (cmd === "admin") {
        try {
          await handleAdminCommand(this.sock, msg, args);
        } catch (error) {
          log.error("Erro ao processar comando admin:", error.message);
        }
      }
    }
  }

  // ==================== HANDLER DE GRUPOS ====================
  async handleGroupUpdate(update) {
    const { id, participants, action } = update;

    if (action === "add" && participants.includes(this.sock.user.id)) {
      log.info(`➕ Bot adicionado ao grupo: ${id}`);

      setTimeout(async () => {
        try {
          await this.sock.sendMessage(id, {
            text: "🤖 Bot de Afiliados ativo!\nUse #admin help para ver comandos.",
          });
        } catch (error) {
          log.error("Erro ao enviar boas-vindas:", error.message);
        }
      }, 2000);
    }
  }

  // ==================== PARADA CONTROLADA ====================
  async stop() {
    return this.withMutex("stopMutex", async () => {
      if (this.state === BotState.STOPPED || this.state === BotState.STOPPING) {
        log.warn("⚠️ Bot já está parado ou parando");
        return { success: false, reason: "already_stopped" };
      }

      this.state = BotState.STOPPING;
      log.info("🛑 Parando bot...");

      try {
        await this.cleanup(true);
        this.state = BotState.STOPPED;
        log.info("✅ Bot parado com sucesso");
        return { success: true };
      } catch (error) {
        log.error("❌ Erro ao parar bot:", error);
        this.state = BotState.ERROR;
        return { success: false, error: error.message };
      }
    });
  }

  // ==================== LIMPEZA DE RECURSOS ====================
  async cleanup(full = true) {
    // Limpar timeout de reconexão
    this.clearReconnectTimeout();

    // Limpar event listeners
    this.cleanupEventListeners();

    // Parar scheduler
    if (this.scheduler) {
      try {
        this.scheduler.stop();
        log.info("🗓️ Scheduler parado");
      } catch (error) {
        log.error("Erro ao parar scheduler:", error.message);
      }
      this.scheduler = null;
    }

    // Limpar groupSync
    if (this.groupSync) {
      this.groupSync = null;
    }

    // Fechar socket (apenas se parada completa)
    if (full && this.sock) {
      try {
        await this.sock.end();
        log.info("🔌 Socket fechado");
      } catch (error) {
        log.error("Erro ao fechar socket:", error.message);
      }
      this.sock = null;
    }

    // Limpar info de conexão (apenas se parada completa)
    if (full) {
      this.connectionInfo = null;
    }
  }

  // ==================== UTILITÁRIOS ====================
  cleanupEventListeners() {
    this.eventCleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        // Silencioso - listener pode já ter sido removido
      }
    });
    this.eventCleanupFns = [];
  }

  clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  scheduleRestart(delay) {
    this.clearReconnectTimeout();

    log.info(`🔄 Reconexão agendada para ${delay / 1000}s`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.start();
      } catch (error) {
        log.error("❌ Falha na reconexão:", error);
        // Backoff exponencial
        this.scheduleRestart(Math.min(delay * 2, 60000));
      }
    }, delay);
  }

  displayQRCode(qr) {
    console.log("\n" + "═".repeat(50));
    console.log("📱 ESCANEIE O QR CODE COM SEU WHATSAPP");
    console.log("═".repeat(50) + "\n");
    qrcode.generate(qr, { small: true });
    console.log("\n" + "═".repeat(50));
    console.log("📲 INSTRUÇÕES:");
    console.log("1. Abra o WhatsApp no celular");
    console.log("2. Toque em ⋮ (três pontos)");
    console.log('3. Escolha "Aparelhos conectados"');
    console.log('4. Toque em "Conectar um aparelho"');
    console.log("5. Aponte a câmera para o QR acima");
    console.log("═".repeat(50) + "\n");
  }

  // ==================== HANDLERS GLOBAIS ====================
  setupGlobalHandlers() {
    // Prevenir múltiplos listeners
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");

    process.once("SIGINT", () => this.handleShutdown("SIGINT"));
    process.once("SIGTERM", () => this.handleShutdown("SIGTERM"));

    process.on("uncaughtException", (error) => {
      log.error("❌ Uncaught Exception:", error);
      // Não reinicia em exceções não tratadas - pode ser fatal
    });

    process.on("unhandledRejection", (error) => {
      log.error("❌ Unhandled Rejection:", error);
    });

    process.setMaxListeners(20);
  }

  async handleShutdown(signal) {
    log.info(`\n👋 Recebido ${signal}, encerrando...`);
    await this.stop();
    process.exit(0);
  }

  // ==================== STATUS ====================
  getStatus() {
    return {
      state: this.state,
      isRunning: this.state === BotState.CONNECTED,
      qr: this.qrData.code,
      qrExpired: this.qrData.expiresAt && Date.now() > this.qrData.expiresAt,
      qrAttempts: this.qrData.attemptCount,
      connection: this.connectionInfo,
      hasScheduler: Boolean(this.scheduler),
      timestamp: new Date().toISOString(),
    };
  }
}

// ==================== INSTÂNCIA SINGLETON ====================
const bot = new WhatsAppBot();

// ==================== EXPORTAÇÕES ====================
export async function startBot() {
  return bot.start();
}

export async function stopBot() {
  return bot.stop();
}

export function getStatus() {
  return bot.getStatus();
}

// ==================== BANNER ====================
console.log(`
╔═══════════════════════════════════════════════╗
║      BOT DE AFILIADOS - WHATSAPP v2.0         ║
║          Otimizado e Estável                  ║
╚═══════════════════════════════════════════════╝
`);
