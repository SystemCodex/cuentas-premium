module.exports = {
  apps: [
    {
      name: 'premium-accounts-platform',
      script: 'npm',
      args: 'run start',
      cwd: '/home/USER/premium-accounts-platform',
      env: {
        NODE_ENV: 'production',
        PORT: 4002
      },
      max_memory_restart: '768M',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true
    }
  ]
};
