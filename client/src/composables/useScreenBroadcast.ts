import { ref, shallowRef } from 'vue'
import type { RtcClientMessage, RtcServerMessage } from '../types'

/**
 * 屏幕转播（WebRTC mesh P2P）：
 * - 主播：getDisplayMedia 采集屏幕/窗口（含系统音频，采得到就推流），
 *   每个观众各建一条 RTCPeerConnection 推流（单一直播间，服务端仲裁先到先得）
 * - 观众：向主播发 watch，收 offer 回 answer，ontrack 拿到远端流
 * - 信令经聊天 WebSocket 的 'RTC:' 帧传输（见 useWebSocket），ICE trickle 候选
 *   在远端描述设置完成前先缓冲、之后 flush，防止乱序
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

interface PeerEntry {
  pc: RTCPeerConnection
  pendingIce: RTCIceCandidateInit[]
}

export function useScreenBroadcast(api: {
  onSignaling: (cb: (msg: RtcServerMessage) => void) => () => boolean
  sendSignaling: (msg: RtcClientMessage) => void
  appendMessage: (name: string, message: string) => void
}) {
  const { onSignaling, sendSignaling, appendMessage } = api

  const myId = ref('')
  // 当前直播间：别人的转播（id + 展示用 IP）
  const activeBroadcast = ref<{ id: string; label: string } | null>(null)
  const isBroadcasting = ref(false)
  const isWatching = ref(false)
  const viewerCount = ref(0)
  const localStream = shallowRef<MediaStream | null>(null)
  const remoteStream = shallowRef<MediaStream | null>(null)

  // 主播侧：观众 id → 连接
  const hostPeers = new Map<string, PeerEntry>()
  // 观众侧：与主播的连接
  let viewerEntry: PeerEntry | null = null
  let viewerHostId = ''
  let displayStream: MediaStream | null = null

  function notice(text: string) {
    appendMessage('系统', text)
  }

  function updateViewerCount() {
    let count = 0
    hostPeers.forEach(({ pc }) => {
      if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') count++
    })
    viewerCount.value = count
  }

  async function flushIce(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
    while (queue.length) {
      const candidate = queue.shift()!
      try {
        await pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('addIceCandidate 失败:', err)
      }
    }
  }

  // ---------- 主播侧 ----------

  async function startBroadcast() {
    if (isBroadcasting.value) return
    if (activeBroadcast.value) {
      notice('已有人正在转播，无法开始新的转播')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      displayStream = stream
      localStream.value = stream
      // 用户点浏览器自带的「停止共享」时自动收尾
      stream.getVideoTracks()[0]?.addEventListener('ended', () => stopBroadcast())
      sendSignaling({ t: 'start' })
      isBroadcasting.value = true
      notice('转播已开始，等待观众接入')
    } catch {
      notice('未获得屏幕共享权限，转播取消')
    }
  }

  function removeHostPeer(viewerId: string) {
    const entry = hostPeers.get(viewerId)
    if (!entry) return
    hostPeers.delete(viewerId)
    entry.pc.close()
    updateViewerCount()
  }

  function cleanupHost() {
    hostPeers.forEach(({ pc }) => pc.close())
    hostPeers.clear()
    displayStream?.getTracks().forEach((track) => track.stop())
    displayStream = null
    localStream.value = null
    isBroadcasting.value = false
    viewerCount.value = 0
  }

  function stopBroadcast() {
    if (!isBroadcasting.value) return
    sendSignaling({ t: 'stop' })
    cleanupHost()
    notice('转播已结束')
  }

  async function handleWatch(viewerId: string) {
    if (!isBroadcasting.value || !displayStream) return
    removeHostPeer(viewerId)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry: PeerEntry = { pc, pendingIce: [] }
    hostPeers.set(viewerId, entry)
    const stream = displayStream
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignaling({ t: 'ice', to: viewerId, candidate: event.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removeHostPeer(viewerId)
      updateViewerCount()
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendSignaling({ t: 'offer', to: viewerId, sdp: offer })
    updateViewerCount()
  }

  async function handleAnswer(viewerId: string, sdp: RTCSessionDescriptionInit) {
    const entry = hostPeers.get(viewerId)
    if (!entry) return
    await entry.pc.setRemoteDescription(sdp)
    await flushIce(entry.pc, entry.pendingIce)
    updateViewerCount()
  }

  // ---------- 观众侧 ----------

  // 仅断开与主播的连接并清空画面，保持观看状态（重收 offer 重建连接时使用）
  function disposeViewerPc() {
    viewerEntry?.pc.close()
    viewerEntry = null
    viewerHostId = ''
    remoteStream.value = null
  }

  function cleanupViewer() {
    disposeViewerPc()
    isWatching.value = false
  }

  function watchBroadcast() {
    const host = activeBroadcast.value
    if (!host || isBroadcasting.value || isWatching.value) return
    sendSignaling({ t: 'watch', to: host.id })
    isWatching.value = true
  }

  function stopWatching() {
    if (!isWatching.value) return
    if (viewerHostId) sendSignaling({ t: 'leave', to: viewerHostId })
    cleanupViewer()
  }

  async function handleOffer(hostId: string, sdp: RTCSessionDescriptionInit) {
    const host = activeBroadcast.value
    // 只接受当前主播的 offer
    if (!host || host.id !== hostId || !isWatching.value) return
    // 丢弃旧连接重建，但不能退出观看状态，否则面板会随 offer 一起消失
    disposeViewerPc()
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry: PeerEntry = { pc, pendingIce: [] }
    viewerEntry = entry
    viewerHostId = hostId
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignaling({ t: 'ice', to: hostId, candidate: event.candidate.toJSON() })
    }
    pc.ontrack = (event) => {
      remoteStream.value = event.streams[0] ?? new MediaStream([event.track])
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') cleanupViewer()
    }
    await pc.setRemoteDescription(sdp)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    sendSignaling({ t: 'answer', to: hostId, sdp: answer })
    await flushIce(pc, entry.pendingIce)
  }

  // ---------- 信令分发 ----------

  onSignaling((msg) => {
    switch (msg.t) {
      case 'welcome':
        myId.value = msg.id
        if (msg.host) activeBroadcast.value = msg.host
        break
      case 'started':
        if (!isBroadcasting.value) {
          activeBroadcast.value = { id: msg.from, label: msg.label }
          notice(`${msg.label} 开始了屏幕转播，点击「观看直播」收看`)
        }
        break
      case 'stopped':
        if (activeBroadcast.value?.id === msg.from) {
          activeBroadcast.value = null
          if (isWatching.value) cleanupViewer()
          notice('转播已结束')
        }
        break
      case 'denied':
        if (isBroadcasting.value) {
          cleanupHost()
          notice('已有人正在转播，本次开始请求被拒绝')
        }
        break
      case 'watch':
        void handleWatch(msg.from)
        break
      case 'leave':
        removeHostPeer(msg.from)
        break
      case 'answer':
        void handleAnswer(msg.from, msg.sdp)
        break
      case 'offer':
        void handleOffer(msg.from, msg.sdp)
        break
      case 'ice': {
        const hostEntry = hostPeers.get(msg.from)
        if (hostEntry) {
          if (hostEntry.pc.remoteDescription) void flushIce(hostEntry.pc, [msg.candidate])
          else hostEntry.pendingIce.push(msg.candidate)
        } else if (viewerEntry && msg.from === viewerHostId) {
          if (viewerEntry.pc.remoteDescription) void flushIce(viewerEntry.pc, [msg.candidate])
          else viewerEntry.pendingIce.push(msg.candidate)
        }
        break
      }
    }
  })

  /** 页面卸载时统一收尾（不广播系统提示） */
  function cleanup() {
    if (isBroadcasting.value) {
      sendSignaling({ t: 'stop' })
      cleanupHost()
    }
    if (isWatching.value) {
      if (viewerHostId) sendSignaling({ t: 'leave', to: viewerHostId })
      cleanupViewer()
    }
  }

  return {
    isBroadcasting,
    activeBroadcast,
    isWatching,
    viewerCount,
    localStream,
    remoteStream,
    startBroadcast,
    stopBroadcast,
    watchBroadcast,
    stopWatching,
    cleanup,
  }
}
