const { chromium } = require('playwright');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const expressWs = require('express-ws');
const { v4: uuidv4 } = require('uuid'); // 为每个客户端生成唯一ID

// 创建Express应用
const app = express();
app.use(express.static(__dirname));

// 创建HTTP服务器
const server = http.createServer(app);

// 设置express-ws，将WebSocket功能添加到Express应用
const wsInstance = expressWs(app, server);

// 客户端会话管理
const sessions = new Map(); // 使用Map存储客户端会话

// 处理鼠标事件的函数
async function handleMouseEvent(event, browserPage) {
  if (!browserPage || browserPage.isClosed()) {
    console.error('浏览器页面未初始化或已关闭');
    return;
  }

  try {
    // 计算绝对坐标
    const x = Math.round(event.x * event.screenWidth);
    const y = Math.round(event.y * event.screenHeight);

    console.log(`执行鼠标事件: ${event.action} 在坐标 (${x}, ${y})`);

    switch (event.action) {
      case 'move':
        await browserPage.mouse.move(x, y);
        break;

      case 'down':
        const buttonDown = event.button === 2 ? 'right' : (event.button === 1 ? 'middle' : 'left');
        await browserPage.mouse.down({ button: buttonDown });
        break;

      case 'up':
        const buttonUp = event.button === 2 ? 'right' : (event.button === 1 ? 'middle' : 'left');
        await browserPage.mouse.up({ button: buttonUp });
        break;

      case 'click':
        const buttonClick = event.button === 2 ? 'right' : (event.button === 1 ? 'middle' : 'left');
        await browserPage.mouse.click(x, y, { button: buttonClick });
        break;

      case 'contextmenu':
        await browserPage.mouse.click(x, y, { button: 'right' });
        break;

      case 'dblclick':
        await browserPage.mouse.dblclick(x, y);
        break;

      case 'wheel':
        // 优化的滚动处理
        await browserPage.evaluate(({ x, y, deltaX, deltaY }) => {
          // 查找鼠标位置下最适合滚动的元素
          const element = document.elementFromPoint(x, y);
          if (!element) return;

          // 查找可滚动的父元素
          let target = element;
          while (target && target !== document.documentElement) {
            const style = window.getComputedStyle(target);
            const overflow = style.getPropertyValue('overflow') +
              style.getPropertyValue('overflow-y') +
              style.getPropertyValue('overflow-x');

            const isScrollable = /(auto|scroll|overlay)/.test(overflow) &&
              (target.scrollHeight > target.clientHeight ||
                target.scrollWidth > target.clientWidth);

            if (isScrollable) {
              // 找到可滚动元素，执行滚动
              const scale = 0.5; // 降低滚动速度
              target.scrollBy({
                top: deltaY * scale,
                left: deltaX * scale,
                behavior: 'auto' // 使用即时滚动以避免延迟
              });
              return; // 找到并处理后退出
            }
            target = target.parentElement;
          }

          // 如果没有找到可滚动元素，则滚动整个页面
          window.scrollBy({
            top: deltaY * 0.5,
            left: deltaX * 0.5,
            behavior: 'auto'
          });
        }, { x, y, deltaX: event.deltaX, deltaY: event.deltaY });
        break;
    }
  } catch (error) {
    console.error(`执行鼠标事件出错: ${error.message}`);
  }
}

// 处理键盘事件的函数
async function handleKeyboardEvent(event, browserPage) {
  if (!browserPage || browserPage.isClosed()) {
    console.error('浏览器页面未初始化或已关闭');
    return;
  }

  // 存储每个会话的最近处理的事件时间戳
  if (!browserPage._lastKeyEvents) browserPage._lastKeyEvents = {};
  const lastKeyEvents = browserPage._lastKeyEvents;
  const MIN_EVENT_INTERVAL = 50;

  try {
    // 检查是否在短时间内处理过此按键
    const now = Date.now();
    const eventKey = `${event.code}_${event.action}`;

    if (lastKeyEvents[eventKey] && now - lastKeyEvents[eventKey] < MIN_EVENT_INTERVAL) {
      return; // 忽略短时间内的重复事件
    }

    // 记录事件处理时间
    lastKeyEvents[eventKey] = now;

    // 输出日志（只记录非修饰键）
    if (event.action === 'down' &&
      !/^(Alt|Control|Shift|Meta|OS)/.test(event.code) &&
      !event.key.startsWith('Meta') && !event.key.startsWith('Control') &&
      !event.key.startsWith('Alt') && !event.key.startsWith('Shift')) {
      console.log(`执行键盘事件: ${event.action} 键:${event.key} (${event.code})`);
    }

    switch (event.action) {
      case 'down':
        await browserPage.keyboard.down(event.key);
        break;
      case 'up':
        await browserPage.keyboard.up(event.key);
        break;
    }
  } catch (error) {
    console.error(`执行键盘事件出错: ${error.message}`);
  }
}

// 处理导航请求
async function handleNavigation(action, url, browserPage) {
  try {
    switch (action) {
      case 'back':
        await browserPage.goBack();
        break;
      case 'forward':
        await browserPage.goForward();
        break;
      case 'goto':
        if (url) {
          // 确保URL格式正确
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          await browserPage.goto(url);
        }
        break;
      case 'refresh':
        await browserPage.reload();
        break;
    }

    // 导航后发送新URL
    const currentUrl = browserPage.url();
    return {
      type: 'navigation',
      url: currentUrl,
      canGoBack: await browserPage.evaluate(() => window.history.length > 1),
      canGoForward: await browserPage.evaluate(() => window.history.length > 0 && window.history.state !== null)
    };
  } catch (error) {
    console.error(`导航操作 ${action} 失败:`, error);
    return {
      type: 'navigation',
      error: error.message
    };
  }
}

// 启动浏览器实例
async function createBrowserSession(clientId) {
  try {
    console.log(`为客户端 ${clientId} 创建新的浏览器会话`);

    // 启动浏览器
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--allow-file-access-from-files',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      permissions: ['camera', 'microphone', 'geolocation'],
      hasTouch: false,
      isMobile: false,
      bypassCSP: true,
    });

    // 配置浏览器上下文以允许自动播放
    await context.addInitScript(() => {
      // 移除一些常见的媒体检测
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = async function () {
        try {
          return await originalPlay.apply(this);
        } catch (err) {
          console.warn('自动播放被阻止，尝试绕过:', err);
          this.muted = true;
          return originalPlay.apply(this);
        }
      };

      // 重写window.open方法
      const originalOpen = window.open;
      window.open = function (url, target, features) {
        console.log('拦截到window.open调用:', url);
        if (url) {
          window.location.href = url;
          return window; // 返回当前窗口以避免脚本错误
        }
        return originalOpen.apply(this, arguments);
      };
    });

    // 创建页面
    const page = await context.newPage();

    // 设置超时
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    // 添加事件监听，拦截新开标签页的链接
    await page.addInitScript(() => {
      // 监听所有点击事件，捕获阶段
      document.addEventListener('click', function (e) {
        // 查找最近的链接元素
        let target = e.target;
        while (target && target.tagName !== 'A') {
          target = target.parentElement;
        }

        // 如果点击的是链接
        if (target && target.tagName === 'A') {
          const href = target.getAttribute('href');
          const target_attr = target.getAttribute('target');

          // 如果链接试图打开新标签页
          if (target_attr === '_blank' && href) {
            console.log('拦截到新标签页链接:', href);
            e.preventDefault(); // 阻止默认行为
            e.stopPropagation(); // 停止事件传播

            // 在当前页面打开链接
            window.location.href = href;
            return false;
          }
        }
      }, true);
    });

    // 打开空白页面
    await page.goto('about:blank');

    // 创建会话对象
    const session = {
      id: clientId,
      browser,
      context,
      page,
      captureInterval: null,
      lastCaptureTime: Date.now(),
      pendingCapture: false,
      latestScreenshot: null,
      screenshotWidth: 1280,
      screenshotHeight: 720,
      clients: [] // 连接到此会话的WebSocket客户端
    };

    // 设置自动截图
    startCaptureInterval(session);

    // 设置页面事件
    setupPageEvents(session);

    return session;
  } catch (error) {
    console.error(`为客户端 ${clientId} 创建浏览器会话失败:`, error);
    throw error;
  }
}

// 设置页面事件监听
function setupPageEvents(session) {
  const { page } = session;

  // 监听页面导航事件，发送当前URL给客户端
  page.on('load', async () => {
    // 获取当前URL并发送给客户端
    const currentUrl = page.url();
    session.clients.forEach(async client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({
            type: 'navigation',
            url: currentUrl,
            canGoBack: await page.evaluate(() => window.history.length > 1),
            canGoForward: await page.evaluate(() => window.history.length > 0 && window.history.state !== null)
          }));
        } catch (error) {
          console.error('发送导航信息失败:', error);
        }
      }
    });

    // 重新获取页面尺寸
    const newDimensions = await page.evaluate(() => {
      return {
        width: Math.min(document.documentElement.scrollWidth, 1280),
        height: Math.min(document.documentElement.scrollHeight, 720)
      };
    });

    session.screenshotWidth = newDimensions.width;
    session.screenshotHeight = newDimensions.height;
  });

  // 页面错误处理
  page.on('pageerror', error => {
    console.error(`页面错误 (客户端 ${session.id}): ${error.message}`);
  });

  // 控制台消息处理
  page.on('console', msg => {
    console.log(`页面控制台 (客户端 ${session.id}): ${msg.text()}`);
  });

  // 对话框自动处理
  page.on('dialog', async dialog => {
    console.log(`页面对话框 (客户端 ${session.id}): ${dialog.message()}`);
    await dialog.accept(); // 自动接受所有对话框
  });
}

// 开始定期截图
function startCaptureInterval(session) {
  session.captureInterval = setInterval(async () => {
    // 跳过如果上一次截图还未完成或者没有客户端连接
    if (session.pendingCapture || Date.now() - session.lastCaptureTime < 50 || session.clients.length === 0) {
      return;
    }

    session.pendingCapture = true;
    session.lastCaptureTime = Date.now();

    try {
      if (!session.page.isClosed()) {
        // 使用Playwright截取屏幕截图
        const screenshot = await session.page.screenshot({
          type: 'jpeg',
          fullPage: true,
          clip: {
            x: 0,
            y: 0,
            width: session.screenshotWidth,
            height: session.screenshotHeight
          },
          quality: 75,
          omitBackground: false
        });

        // 保存最新的截图
        session.latestScreenshot = screenshot;

        // 当前时间戳
        const timestamp = Date.now();

        // 发送给所有连接到此会话的客户端
        session.clients.forEach((client, index) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              // 首先发送元数据
              client.send(JSON.stringify({
                type: 'metadata',
                width: session.screenshotWidth,
                height: session.screenshotHeight,
                timestamp: timestamp
              }));

              // 然后发送二进制数据
              client.send(screenshot);
            } catch (sendError) {
              console.error(`向客户端 ${session.id} 发送截图时出错:`, sendError);
            }
          }
        });
      }
    } catch (error) {
      console.error(`客户端 ${session.id} 截取屏幕截图错误:`, error);
    } finally {
      session.pendingCapture = false;
    }
  }, 16); // 约60fps
}

// 清理会话资源
async function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`清理客户端 ${sessionId} 的会话资源`);

  // 清理定时器
  if (session.captureInterval) {
    clearInterval(session.captureInterval);
  }

  // 关闭浏览器
  try {
    if (session.browser) {
      await session.browser.close();
    }
  } catch (error) {
    console.error(`关闭客户端 ${sessionId} 的浏览器出错:`, error);
  }

  // 从会话列表中移除
  sessions.delete(sessionId);
  console.log(`客户端 ${sessionId} 会话已清理`);
}

// 主WebSocket路由处理客户端连接
app.ws('/', async (ws, req) => {
  // 为每个连接生成唯一ID
  const clientId = uuidv4();
  console.log(`新客户端连接: ${clientId}`);

  // 创建新的浏览器会话
  let session;
  try {
    session = await createBrowserSession(clientId);
    sessions.set(clientId, session);

    // 将WebSocket客户端添加到会话
    session.clients.push(ws);
  } catch (error) {
    console.error(`为客户端 ${clientId} 创建会话失败:`, error);
    ws.close();
    return;
  }

  // 设置WebSocket为二进制模式
  ws.binaryType = 'arraybuffer';

  // 将客户端ID存储在WebSocket对象上，以便在关闭时识别
  ws.clientId = clientId;

  // 如果有截图数据，立即发送
  if (session.latestScreenshot) {
    try {
      ws.send(JSON.stringify({
        type: 'metadata',
        width: session.screenshotWidth,
        height: session.screenshotHeight,
        timestamp: Date.now()
      }));
      ws.send(session.latestScreenshot);
    } catch (error) {
      console.error(`向客户端 ${clientId} 发送初始截图失败:`, error);
    }
  }

  // 客户端断开连接
  ws.on('close', async () => {
    console.log(`客户端断开连接: ${clientId}`);

    // 从会话中移除此客户端
    if (session) {
      session.clients = session.clients.filter(client => client !== ws);

      // 如果没有更多客户端连接到此会话，立即清理资源
      if (session.clients.length === 0) {
        // 先关闭标签页，再清理其他资源
        try {
          if (session.page && !session.page.isClosed()) {
            await session.page.close();
          }
        } catch (error) {
          console.error(`关闭客户端 ${clientId} 的标签页时出错:`, error);
        }
        await cleanupSession(clientId);
      }
    }
  });

  // 处理来自客户端的消息
  ws.on('message', async (message) => {
    try {
      // 确保会话仍然存在
      if (!sessions.has(clientId)) {
        console.error(`客户端 ${clientId} 的会话已不存在`);
        return;
      }

      const currentSession = sessions.get(clientId);

      // 检查是否是文本消息
      if (typeof message === 'string' || message instanceof Buffer) {
        const data = JSON.parse(message.toString());

        // 处理鼠标事件
        if (data.type === 'mouse') {
          // 添加屏幕尺寸到事件数据中
          data.screenWidth = currentSession.screenshotWidth;
          data.screenHeight = currentSession.screenshotHeight;
          handleMouseEvent(data, currentSession.page);
        }
        // 处理键盘事件
        else if (data.type === 'keyboard') {
          handleKeyboardEvent(data, currentSession.page);
        }
        // 处理导航事件
        else if (data.type === 'navigation') {
          const result = await handleNavigation(data.action, data.url, currentSession.page);
          ws.send(JSON.stringify(result));
        }
        // 处理客户端配置更改
        else if (data.type === 'config') {
          // 更新会话的图像质量设置
          updateSessionConfig(currentSession, data);
        }
      }
    } catch (e) {
      console.error(`处理客户端 ${clientId} 消息错误:`, e);
    }
  });

  // 发送客户端ID到客户端
  ws.send(JSON.stringify({
    type: 'session',
    clientId: clientId
  }));
});

// 更新会话配置
function updateSessionConfig(session, config) {
  if (config.quality) {
    // 根据客户端请求的质量调整截图参数
    switch (config.quality) {
      case 'low':
        session.imageQuality = 50; // 较低的JPEG质量
        session.captureInterval = 100; // 降低捕获频率
        break;
      case 'medium':
        session.imageQuality = 70;
        session.captureInterval = 33; // ~30fps
        break;
      case 'high':
        session.imageQuality = 85;
        session.captureInterval = 16; // ~60fps
        break;
      default:
        session.imageQuality = 70;
        session.captureInterval = 33;
    }

    console.log(`客户端 ${session.id} 配置已更新: 质量=${config.quality}, 间隔=${session.captureInterval}ms`);

    // 重新设置捕获间隔
    if (session.captureIntervalId) {
      clearInterval(session.captureIntervalId);
      startCaptureInterval(session);
    }
  }
}

// 开始定期截图 - 优化版本
function startCaptureInterval(session) {
  // 初始化默认值
  if (!session.imageQuality) session.imageQuality = 70;
  if (!session.captureInterval) session.captureInterval = 33;

  // 初始化节流变量
  let throttleTime = 0;
  const THROTTLE_THRESHOLD = 200; // ms

  session.captureIntervalId = setInterval(async () => {
    // 跳过如果上一次截图还未完成或者没有客户端连接
    if (session.pendingCapture || session.clients.length === 0) {
      return;
    }

    // 当负载较高时进行节流
    const now = Date.now();
    if (now - session.lastCaptureTime < session.captureInterval / 2) {
      throttleTime += session.captureInterval;
      if (throttleTime < THROTTLE_THRESHOLD) return;
      throttleTime = 0;
    } else {
      throttleTime = 0;
    }

    session.pendingCapture = true;
    session.lastCaptureTime = now;

    try {
      if (!session.page.isClosed()) {
        // 使用Playwright截取屏幕截图，优化质量参数
        const screenshot = await session.page.screenshot({
          type: 'jpeg',
          fullPage: false, // 不使用全页面截图以提高性能
          clip: {
            x: 0,
            y: 0,
            width: session.screenshotWidth,
            height: session.screenshotHeight
          },
          quality: session.imageQuality, // 使用动态质量
          omitBackground: false
        });

        // 保存最新的截图
        session.latestScreenshot = screenshot;

        // 当前时间戳
        const timestamp = Date.now();

        // 发送给所有连接到此会话的客户端
        for (let client of session.clients) {
          if (client.readyState === WebSocket.OPEN) {
            try {
              // 首先发送元数据
              client.send(JSON.stringify({
                type: 'metadata',
                width: session.screenshotWidth,
                height: session.screenshotHeight,
                timestamp: timestamp
              }));

              // 然后发送二进制数据
              client.send(screenshot);
            } catch (sendError) {
              console.error(`向客户端 ${session.id} 发送截图时出错:`, sendError);
            }
          }
        }
      }
    } catch (error) {
      console.error(`客户端 ${session.id} 截取屏幕截图错误:`, error);
    } finally {
      session.pendingCapture = false;
    }
  }, session.captureInterval);
}

// 清理会话资源 - 修改以清理captureIntervalId
async function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`清理客户端 ${sessionId} 的会话资源`);

  // 清理定时器
  if (session.captureIntervalId) {
    clearInterval(session.captureIntervalId);
  }

  // 关闭浏览器
  try {
    if (session.browser) {
      await session.browser.close();
    }
  } catch (error) {
    console.error(`关闭客户端 ${sessionId} 的浏览器出错:`, error);
  }

  // 从会话列表中移除
  sessions.delete(sessionId);
  console.log(`客户端 ${sessionId} 会话已清理`);
}

// 启动服务器
const PORT = 9000;
server.listen(PORT, async () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);

  // 处理服务器关闭
  process.on('SIGINT', async () => {
    console.log('正在关闭服务器和所有浏览器会话...');

    // 清理所有会话
    for (const sessionId of sessions.keys()) {
      await cleanupSession(sessionId);
    }

    process.exit(0);
  });
});
