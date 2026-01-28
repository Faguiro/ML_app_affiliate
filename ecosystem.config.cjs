module.exports = {
  apps : [
    // 1. O Monitor Python (que estava dando erro)
    {
      name: "bot-monitor",
      cwd: "./telegram", // Define a pasta de trabalho correta
      script: "bot_monitor.py",
      // O PULO DO GATO: Caminho absoluto para o Python do VENV
      interpreter: "/home/affiliatebot/ML_app_affiliate/telegram/venv/bin/python",
      autorestart: true,
      watch: false,
      max_memory_restart: '200M'
    },

    // 2. A API Node.js (Server.js)
    {
      name: "meu-app-api",
      cwd: "./", // Executa na raiz onde está o package.json
      script: "server.js",
      // Variáveis de ambiente para o Node
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      autorestart: true,
      watch: false
    }
  ]
}
