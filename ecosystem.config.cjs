// PM2 ecosystem config — Amazon Linux 2/2023 compatible
// Deploy: pm2 start ecosystem.config.cjs --env production
// First time: pm2 startup && pm2 save  (to auto-start on reboot)
module.exports = {
    apps: [
        {
            name: "workspace-api",
            script: "server.js",

            // Single process — keeps Socket.io in-memory state consistent.
            // Scale horizontally (multiple EC2s behind ALB) rather than per-process.
            instances: 1,
            exec_mode: "fork",

            // Never watch files in production
            watch: false,

            // Restart if memory climbs past this threshold (Node heap leak guard)
            max_memory_restart: "800M",

            // Give Node enough heap; leave headroom for the OS
            node_args: "--max-old-space-size=700",

            // Exponential backoff on crash loops; PM2 stops restarting after max_restarts
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            min_uptime: "10s",
            max_restarts: 15,

            // Structured logs — rotate with `pm2 install pm2-logrotate`
            error_file: "./logs/pm2-error.log",
            out_file: "./logs/pm2-out.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: true,

            env: {
                NODE_ENV: "development",
            },
            env_production: {
                NODE_ENV: "production",
                // PORT, DATABASE_URL, JWT_SECRET, REDIS_URL, etc. come from
                // the .env file loaded by dotenv at runtime — do NOT put
                // secrets here.
            },
        },
    ],
};
