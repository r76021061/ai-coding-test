# 使用 Node.js 20 作為基底映像檔
FROM node:20-alpine AS builder

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝依賴
RUN npm install

# 複製所有原始碼
COPY . .

# 建立生產環境版本
RUN npm run build

# --- 生產環境階段 ---
FROM node:20-alpine

WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 僅安裝生產環境依賴 (如果您的 server.ts 依賴 tsx，可能需要保留 devDependencies 或全域安裝 tsx)
RUN npm install --omit=dev && npm install -g tsx

# 從 builder 階段複製編譯好的前端檔案
COPY --from=builder /app/dist ./dist

# 複製 server.ts 和其他必要檔案
COPY server.ts ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY tsconfig.app.json ./

# 暴露 3000 埠
EXPOSE 3000

# 啟動伺服器
CMD ["npm", "run", "dev"]
