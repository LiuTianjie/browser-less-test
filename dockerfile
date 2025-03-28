FROM node:20-bookworm

# 替换为国内源
RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list && \
    sed -i 's/security.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libglib2.0-0 \
    libxrender1 \
    libfontconfig1 \
    libfreetype6 \
    xvfb \
    fonts-noto-color-emoji \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# 设置 npm 国内镜像
RUN npm config set registry https://registry.npmmirror.com

# 设置工作目录
WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm install

# 安装 Playwright (仅安装 Chromium)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 9000

# 设置启动命令
CMD ["node", "server.js"]