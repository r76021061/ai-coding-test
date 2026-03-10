FROM node:20-alpine

WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝 npm 依賴套件
RUN npm install

# 複製所有專案檔案
COPY . .

# 暴露應用程式運行的 Port
EXPOSE 3000

# 啟動伺服器
CMD ["npm", "run", "dev"]
