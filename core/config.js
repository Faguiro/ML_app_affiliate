// core/config.js
import 'dotenv/config';

class Config {
    constructor() {
        this.validate();
    }

    validate() {
        const required = ['WHATSAPP_OWNER_NUMBER'];
        for (const key of required) {
            if (!process.env[key]) {
                throw new Error(`Variável de ambiente ${key} é obrigatória`);
            }
        }
    }

    // WhatsApp
    get sessionPath() {
        return process.env.WHATSAPP_SESSION_PATH || './sessions';
    }

    get ownerNumber() {
        return process.env.WHATSAPP_OWNER_NUMBER;
    }

    // Banco de Dados
    get dbPath() {
        return process.env.DB_PATH || './database/affiliate.db';
    }

    // Sistema
    get prefix() {
        return process.env.PREFIX || '#';
    }

    get assistantEnabled() {
        return process.env.ASSISTANT_ENABLED === 'true';
    }

    get botEnabled() {
        return process.env.BOT_ENABLED === 'true';
    }

    // API Externa
    get apiUrl() {
        return process.env.AFFILIATE_API_URL || 'http://192.168.100.5:5000';
    }

    get apiTimeout() {
        return parseInt(process.env.AFFILIATE_API_TIMEOUT) || 30000;
    }

    get maxRetries() {
        return parseInt(process.env.AFFILIATE_MAX_RETRIES) || 3;
    }

    // Agendamento
    get processInterval() {
        return parseInt(process.env.SCHEDULER_PROCESS_INTERVAL) || 300000;
    }

    get sendInterval() {
        return parseInt(process.env.SCHEDULER_SEND_INTERVAL) || 300000;
    }

    // Limites
    get maxLinksPerDay() {
        return parseInt(process.env.MAX_LINKS_PER_GROUP_PER_DAY) || 5;
    }

    get minInterval() {
        return parseInt(process.env.MIN_INTERVAL_BETWEEN_MESSAGES) || 300;
    }

    // Método auxiliar para verificar se é dono
    isOwner(jid) {
        return jid.includes(this.ownerNumber);
    }

    get groqApiKey() {
        return process.env.GROQ_API_KEY;
    }

    get aiEnabled() {
        return process.env.AI_ENABLED === "true" 
    }

    get is_description() {
        return process.env.DESCRIPTION === 'true' 
    }
}

export const config = new Config();
