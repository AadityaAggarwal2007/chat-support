module.exports = {
  apps: [
    {
      name: 'chat-server',
      cwd: './server',
      script: 'src/index.js',
      env: { NODE_ENV: 'production', PORT: 5000 },
      watch: false,
      max_memory_restart: '300M',
    },
    {
      name: 'chat-dashboard',
      cwd: './dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 5001',
      env: { NODE_ENV: 'production' },
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
