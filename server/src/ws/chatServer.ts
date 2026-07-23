import fs from 'node:fs'
import https from 'node:https'
import { WebSocket, WebSocketServer } from 'ws'
import { pool } from '../db.js'

// 写入聊天日志表（对应原 socket_node.js 的 logToDatabase）
function logToDatabase(sender: string, message: string) {
  pool
    .query('INSERT INTO logs (sender, message) VALUES (?, ?)', [sender, message])
    .then(() => console.log('日志插入成功'))
    .catch((err: any) => console.log('插入日志失败:', err))
}

export function startChatServer() {
  const port = Number(process.env.WS_PORT ?? 9000)
  const useSSL = process.env.WS_USE_SSL === 'true'

  // 客户端连接（按 IP 记录；同 IP 会覆盖——保留原行为）
  const clients = new Map<string, WebSocket>()

  let wss: WebSocketServer
  if (useSSL) {
    // 生产：wss（安全 WebSocket）
    const server = https.createServer({
      cert: fs.readFileSync(process.env.WS_CERT_PATH || 'certs/server.pem'),
      key: fs.readFileSync(process.env.WS_KEY_PATH || 'certs/server.key'),
    })
    wss = new WebSocketServer({ server })
    server.listen(port, () => console.log(`WebSocket 安全服务器已启动，监听端口 ${port}`))
  } else {
    // 开发：ws（明文）
    wss = new WebSocketServer({ port })
    console.log(`WebSocket 服务器已启动，监听端口 ${port}`)
  }

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress || 'unknown'
    clients.set(clientIP, ws)
    console.log('客户端已连接，IP 地址: %s', clientIP)
    logToDatabase('系统', `客户端已连接，IP 地址: ${clientIP}`)

    ws.on('message', (message) => {
      const msg = message.toString()
      console.log(`收到消息: ${clientIP}, 内容: ${msg}`)
      logToDatabase(clientIP, msg)
      // 广播给除自己外的所有就绪客户端，格式严格保留 "<ip>: <message>"
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== ws) {
          client.send(`${clientIP}: ${msg}`)
        }
      })
    })

    ws.on('close', () => {
      clients.delete(clientIP)
      console.log('客户端已断开连接，IP 地址: %s', clientIP)
      logToDatabase('系统', `客户端已断开连接，IP 地址: ${clientIP}`)
    })
  })
}
