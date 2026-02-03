module.exports = {
  apps: [
    // 🐍 Bot Python
    {
      name: "bot-monitor",
      cwd: "/home/affiliatebot/ML_app_affiliate/telegram",
      script: "bot_monitor.py",
      interpreter: "/home/affiliatebot/ML_app_affiliate/telegram/venv/bin/python",
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      out_file: "/var/log/apps/bot-monitor.log",
      error_file: "/var/log/apps/bot-monitor-error.log"
    },

    // 🌐 API Node
    {
      name: "meu-app-api",
      cwd: "/home/affiliatebot/ML_app_affiliate",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      autorestart: true,
      watch: false,
      out_file: "/var/log/apps/meu-app-api.log",
      error_file: "/var/log/apps/meu-app-api-error.log"
    }
  ]
};
