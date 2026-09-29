module.exports = {
  apps: [
    {
      name: "new21",
      script: "src/index.js",
      node_args: "--env-file=.env",
      watch: false,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
