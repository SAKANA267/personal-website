// pm2 进程配置 —— 随代码一起传到服务器部署根目录后执行。
// 生产沿用本地的方式：用 tsx 直接运行 TS 源码（无编译步骤）。
//
// 关键约束（勿随意改动，否则与 server/src/index.ts 的路径推导不一致）：
//   - cwd 必须是 <DEPLOY_DIR>/server，这样：
//       1) dotenv 能读到 server/.env（dotenv 读取 process.cwd()/.env）
//       2) index.ts 内由 __dirname 推导的 '../../client/dist' 能命中
//          <DEPLOY_DIR>/client/dist
module.exports = {
  apps: [
    {
      name: 'personal-website',
      cwd: __dirname + '/server',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
