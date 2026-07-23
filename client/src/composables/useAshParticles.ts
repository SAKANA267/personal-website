/**
 * 灰烬粒子背景效果，1:1 移植自原 ash_animation.js。
 * 在指定容器内生成随机形状/颜色/大小的粒子，从右下漂向左上并淡出。
 */
export function useAshParticles() {
  let interval: ReturnType<typeof setInterval> | undefined
  const timeouts: ReturnType<typeof setTimeout>[] = []

  function createEmberShape() {
    const shapeType = Math.floor(Math.random() * 3)
    const ember = document.createElement('div')
    ember.className = 'ember'

    const size = Math.random() * 4
    ember.style.width = `${size}px`
    ember.style.height = `${size}px`

    switch (shapeType) {
      case 0: // 圆形
        ember.style.borderRadius = '50%'
        break
      case 1: // 方形旋转
        ember.style.borderRadius = '2px'
        ember.style.transform = `rotate(${Math.random() * 360}deg)`
        break
      case 2: // 不规则形状
        ember.style.borderRadius = `${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}%`
        break
    }

    if (Math.random() > 0.5) ember.style.backgroundColor = 'white'
    else ember.style.backgroundColor = 'black'

    ember.style.opacity = String(0.8 + Math.random() * 0.2)
    return ember
  }

  function createEmber(container: HTMLElement) {
    const ember = createEmberShape()
    container.appendChild(ember)

    const startX = window.innerWidth * (1 + Math.random() * 0.5)
    const startY = window.innerHeight * (0.5 + Math.random() * 0.5)
    const endX = Math.random() * (window.innerWidth * 0.3)
    const endY = Math.random() * (window.innerHeight * 0.5)
    const duration = 4000 + Math.random() * 6000

    ember.style.left = `${startX}px`
    ember.style.top = `${startY}px`

    const t = setTimeout(() => {
      ember.style.transition = `transform ${duration}ms ease-out, opacity ${duration * 0.8}ms ease-in, left ${duration}ms linear, top ${duration}ms ease-in-out`
      ember.style.left = `${endX}px`
      ember.style.top = `${endY}px`
      ember.style.opacity = '0'
      setTimeout(() => ember.remove(), duration)
    }, 10)
    timeouts.push(t)
  }

  function start(container: HTMLElement) {
    // 初始一批（各随机延迟）
    for (let i = 0; i < 20; i++) {
      timeouts.push(setTimeout(() => createEmber(container), Math.random() * 1000))
    }
    // 持续创建（每 300ms 生成 1-3 个）
    interval = setInterval(() => {
      const count = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < count; i++) createEmber(container)
    }, 300)
  }

  function stop(container?: HTMLElement) {
    clearInterval(interval)
    timeouts.forEach(clearTimeout)
    if (container) container.innerHTML = ''
  }

  return { start, stop }
}
