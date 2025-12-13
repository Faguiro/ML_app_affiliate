// core/logger.js
import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logFile = process.env.LOG_FILE || './logs/bot.log';

export const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: logFile })
    ]
});

// Métodos simplificados
export const log = {
    info: (msg) => logger.info(msg),
    error: (msg, err) => logger.error(`${msg}: ${err?.message || err}`),
    warn: (msg) => logger.warn(msg),
    debug: (msg) => logger.debug(msg)
};