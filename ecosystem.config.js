// PM2 ecosystem config
// Start:   pm2 start ecosystem.config.js
// Reload:  pm2 reload ecosystem.config.js --update-env
// Logs:    pm2 logs ipl-confirmation

module.exports = {
  apps: [
    {
      name:         'ipl-confirmation',
      script:       'src/index.js',
      cwd:          '/var/www/ipl_confirmation',
      instances:    1,          // Single instance — whatsapp-web.js is not cluster-safe
      autorestart:  true,
      watch:        false,       // Never use watch in production
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Merge .env file values at runtime — PM2 reads the process environment,
      // so ensure .env is loaded by dotenv inside the app (already done in index.js)
      error_file:  '/var/log/pm2/ipl-confirmation-error.log',
      out_file:    '/var/log/pm2/ipl-confirmation-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
