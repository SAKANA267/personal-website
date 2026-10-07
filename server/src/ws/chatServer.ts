import fs from 'node:fs'
import https from 'node:https'
import { WebSocket, WebSocketServer } from 'ws'
import { pool } from '../db.js'
import { consumeWsToken } from '../wsTokens.js'

// 写入聊天日志表（对应原 socket_node.js 的 logToDatabase）
function logToDatabase(sender: string, message: string) {
  pool
    .query('INSERT INTO logs (sender, message) VALUES (?, ?)', [sender, message])
    .then(() => console.log('日志插入成功'))
    .catch((err: any) => console.log('插入日志失败:', err))
}

// 屏幕转播信令前缀：以 RTC: 开头且能解析出 t 字段的消息走信令路由，
// 不进入聊天广播、不写 logs 表；解析失败则回落为普通聊天文本
const RTC_PREFIX = 'RTC:'

export function startChatServer() {
  const port = Number(process.env.WS_PORT ?? 9000)
  const useSSL = process.env.WS_USE_SSL === 'true'

  // 客户端连接（按 IP 记录；同 IP 会覆盖——保留原行为）
  const clients = new Map<string, WebSocket>()
  // 转播信令路由表：按服务端分配的 peer id 索引，每个连接（含同 IP 多标签页）独立
  const peers = new Map<string, WebSocket>()
  let nextPeerId = 0
  // 单一直播间：当前主播（id + 展示用 IP），先到先得
  let currentHost: { id: string; label: string } | null = null

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

  function sendTo(ws: WebSocket, obj: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) ws.send(RTC_PREFIX + JSON.stringify(obj))
  }

  function broadcastSignaling(obj: Record<string, unknown>, except?: WebSocket) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client !== except) {
        client.send(RTC_PREFIX + JSON.stringify(obj))
      }
    })
  }

  // 处理屏幕转播信令（已确认是合法 RTC 帧）；label 为该连接的展示名（用户名或 IP）
  function handleSignaling(ws: WebSocket, peerId: string, label: string, frame: any) {
    switch (frame.t) {
      case 'start': {
        if (currentHost) {
          sendTo(ws, { t: 'denied', reason: 'busy' })
          return
        }
        currentHost = { id: peerId, label }
        broadcastSignaling({ t: 'started', from: peerId, label }, ws)
        return
      }
      case 'stop': {
        if (!currentHost || currentHost.id !== peerId) return
        currentHost = null
        broadcastSignaling({ t: 'stopped', from: peerId }, ws)
        return
      }
      // 定向转发：watch/leave 给主播，offer/answer/ice 在两端之间
      case 'watch':
      case 'leave':
      case 'offer':
      case 'answer':
      case 'ice': {
        const target = frame.to ? peers.get(String(frame.to)) : undefined
        if (!target || target.readyState !== WebSocket.OPEN) return
        // 观看请求只转发给当前主播；无主播时直接丢弃
        if (frame.t === 'watch' && (!currentHost || currentHost.id !== String(frame.to))) return
        const relay: Record<string, unknown> = { t: frame.t, from: peerId }
        for (const key of ['sdp', 'candidate'] as const) {
          if (frame[key] !== undefined) relay[key] = frame[key]
        }
        sendTo(target, relay)
        return
      }
      default:
        console.log(`未知信令类型: ${frame.t}（来自 ${peerId}）`)
    }
  }

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress || 'unknown'
    // 登录适配：握手 URL 携带一次性 token（Express 签发）换取用户名，游客保持 IP 标识（原行为）
    let username: string | null = null
    try {
      const query = new URL(req.url || '/', 'http://localhost')
      username = consumeWsToken(query.searchParams.get('token'))
    } catch {
      username = null
    }
    // 展示名 = 用户名（登录）或 IP（游客）；clients 键加 @ 前缀避免用户名与 IP 字符串碰撞
    const clientKey = username ? `@${username}` : clientIP
    const display = username || clientIP
    const peerId = `p${++nextPeerId}`
    clients.set(clientKey, ws)
    peers.set(peerId, ws)
    console.log('客户端已连接，IP 地址: %s', clientIP)
    logToDatabase(
      '系统',
      `客户端已连接，${username ? `用户 ${username}` : `IP 地址: ${clientIP}`}`
    )
    // 下发其 peer id 与当前直播状态，晚加入者由此得知有人转播中
    sendTo(ws, { t: 'welcome', id: peerId, host: currentHost })

    ws.on('message', (message) => {
      const msg = message.toString()
      console.log(`收到消息: ${display}, 内容: ${msg}`)

      if (msg.startsWith(RTC_PREFIX)) {
        let frame: any = null
        try {
          frame = JSON.parse(msg.slice(RTC_PREFIX.length))
        } catch {
          frame = null
        }
        // 合法信令帧只做路由，不广播、不写库；解析失败回落为普通聊天
        if (frame && typeof frame.t === 'string') {
          handleSignaling(ws, peerId, display, frame)
          return
        }
      }

      logToDatabase(display, msg)
      // 广播给除自己外的所有就绪客户端，格式保留 "<展示名>: <message>"（登录=用户名，游客=IP）
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== ws) {
          client.send(`${display}: ${msg}`)
        }
      })
    })

    ws.on('close', () => {
      clients.delete(clientKey)
      peers.delete(peerId)
      console.log('客户端已断开连接，IP 地址: %s', clientIP)
      logToDatabase(
        '系统',
        `客户端已断开连接，${username ? `用户 ${username}` : `IP 地址: ${clientIP}`}`
      )
      // 主播断线：释放直播间并通知其余客户端
      if (currentHost && currentHost.id === peerId) {
        currentHost = null
        broadcastSignaling({ t: 'stopped', from: peerId }, ws)
      }
    })
  })
}
