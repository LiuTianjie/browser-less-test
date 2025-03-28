FROM mcr.microsoft.com/playwright:v1.51.1-jammy

# 设置工作目录
WORKDIR /app

# 设置npm国内镜像
RUN npm config set registry https://registry.npmmirror.com

# 复制项目文件
COPY package*.json ./
RUN npm ci

# 复制源代码
COPY . .

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=9000

# 暴露端口
EXPOSE 9000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: 9000, path: '/health', timeout: 2000 }; const req = http.get(options, (res) => { process.exit(res.statusCode >= 200 && res.statusCode < 400 ? 0 : 1); }); req.on('error', (err) => { process.exit(1); }); req.end();"

# 创建一个非root用户并切换
RUN groupadd -r playwright && useradd -r -g playwright -G audio,video playwright \
    && mkdir -p /home/playwright \
    && chown -R playwright:playwright /home/playwright \
    && chown -R playwright:playwright /app

# 切换到非root用户
USER playwright

# 启动命令
CMD ["node", "server.js"]