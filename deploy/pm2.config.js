// pm2 start deploy/pm2.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [{
    name: 'jaathiya-vaarthalu',
    script: 'server/index.js',
    node_args: '--env-file=.env',
    cwd: '/srv/jaathiya-vaarthalu',
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
  }],
};
