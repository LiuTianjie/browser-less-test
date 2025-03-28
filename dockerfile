FROM node:20-bookworm

# 安装 Playwright 和依赖
RUN npx -y playwright@1.51.1 install --with-deps

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果存在)
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 9000

# 设置启动命令
CMD [ "node", "server.js" ]