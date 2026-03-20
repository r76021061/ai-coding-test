# Gooaye Summary App - Kubernetes 部署指南

👉 **[查看開發日誌 (Changelog)](./CHANGELOG.md)**

本專案包含將「股癌/游庭皓影片摘要服務」部署至 Kubernetes (K8s) 的相關設定檔。

## 環境準備 (非常重要)

因為資安考量，Firebase 的設定檔 `firebase-applet-config.json` 已經被加入 `.gitignore`，不會跟著程式碼上傳到 GitHub。
因此，在您進行**本機開發**或**打包 Docker Image** 之前，請務必在專案根目錄手動建立此檔案：

請在專案根目錄建立 `firebase-applet-config.json`，並填入您的 Firebase 設定：

```json
{
  "projectId": "gen-lang-client-0786862796",
  "appId": "1:303942337841:web:f80174299b3b3e10c2dc10",
  "apiKey": "AIzaSyD2PIahhhv9qnMS9b8QXafmP5zUL3Tgzi4",
  "authDomain": "gen-lang-client-0786862796.firebaseapp.com",
  "firestoreDatabaseId": "ai-studio-7be390c8-8f5e-42ea-8fb4-84b354ce7af1",
  "storageBucket": "gen-lang-client-0786862796.firebasestorage.app",
  "messagingSenderId": "303942337841",
  "measurementId": ""
}
```

---

## 部署流程

### 1. 建立敏感資訊 Secret (非常重要)
因為應用程式啟動時需要讀取 API Key 與 SMTP 密碼，如果沒有先建立 Secret，Pod 啟動時會因為抓不到環境變數而直接 Crash。
請**務必在 apply 其他 yaml 檔案之前**，先在您的 K8s 叢集中執行以下指令建立 Secret：

```bash
# 建立環境變數 Secret
kubectl create secret generic gooaye-secrets \
  --from-literal=GEMINI_API_KEY="您的_GEMINI_API_KEY" \
  --from-literal=SMTP_USER="您的_GMAIL_帳號" \
  --from-literal=SMTP_PASS="您的_GMAIL_應用程式密碼"

# 建立 Firebase 設定檔 Secret (從檔案掛載)
kubectl create secret generic firebase-config-secret \
  --from-file=firebase-applet-config.json=./firebase-applet-config.json
```

### 2. 套用 Kubernetes 設定檔
建立好 Secret 之後，接著套用所有的 YAML 設定檔：

```bash
kubectl apply -f ./gke/pvc.yaml
kubectl apply -f ./gke/deployment.yaml
kubectl apply -f ./gke/configmap.yaml
kubectl apply -f ./gke/cronjob.yaml
kubectl apply -f ./gke/service.yaml
```

### 3. 取得 LoadBalancer 外部 IP (GKE)
因為我們將 Service 設定為 `LoadBalancer` 類型，GKE 會自動分配一個外部 IP 給這個服務。
您可以透過以下指令查看分配的 IP：

```bash
kubectl get svc gooaye-summary-service -w
```
當 `EXTERNAL-IP` 從 `<pending>` 變成實際的 IP 地址後（可能需要等 1~3 分鐘），您就可以透過瀏覽器存取 `http://<EXTERNAL-IP>` 來開啟服務了。

---

## 日後更新版本 (上版流程)

為了確保在 Kubernetes (GKE) 環境中能穩定部署與隨時回滾 (Rollback)，**我們不再使用 `latest` 標籤**。
**重要原因：** Docker Hub 的 CDN 機制會快取 `latest` 標籤，這會導致 Kubernetes 節點在拉取 Image 時，即使遠端已經更新，仍可能拉取到舊版的快取檔案。每次上版都必須使用明確的版本號（例如 `v3.0.3`, `v3.0.4` 或是 Git Commit SHA）來強迫 K8s 拉取最新檔案。

> **💡 新增防呆機制 (v3.0.2 起)**：我們已經在 `gke/deployment.yaml` 中加入了 `imagePullPolicy: Always`。這代表即使您不小心推送了相同的標籤，只要執行重啟指令，K8s 也會強制去遠端拉取最新的檔案，不再被本地快取雷到！

當您修改了程式碼並需要重新部署時，請依照以下流程：

### 1. 在本機打包並上傳 Image (標記明確版號)
```bash
# 設定本次上版的版本號 (例如 v3.3.1)
export VERSION=v3.3.1

# 建立 Docker Image (請將 r76021061 替換為您的 Docker Hub 帳號)
docker build -t r76021061/gooaye-summary:$VERSION .

# 推送到 Docker Hub
docker push r76021061/gooaye-summary:$VERSION
```

### 2. 在 K8s 叢集更新服務 (Zero Downtime Deployment)

為了保持 `deployment.yaml` 的靜態與乾淨，我們在檔案中使用了 `VERSION_PLACEHOLDER` 作為佔位符。
請使用 `sed` 指令將環境變數動態替換進去，並直接 pipe 給 `kubectl apply`：

**方法 A：動態替換版號並部署 (推薦，最乾淨)**
```bash
# 使用 sed 將 VERSION_PLACEHOLDER 替換為實際版號，並直接套用 (不會修改到原始的 yaml 檔案)
sed "s/VERSION_PLACEHOLDER/$VERSION/g" ./gke/deployment.yaml | kubectl apply -f -
```

**方法 B：直接使用指令更新 Image (最快速)**
```bash
# 讓 Deployment 直接換上新的 Image 版本，K8s 會自動進行滾動更新 (Rolling Update)
kubectl set image deployment/gooaye-summary-app gooaye-summary=r76021061/gooaye-summary:$VERSION
```

**方法 C：強制重啟 Pod 拉取最新 Image (當您覆蓋了同一個 Tag 時使用)**
如果您推送了相同的版號 (例如覆蓋了 `v3.0.2`)，請執行以下指令強制 K8s 重新拉取：
```bash
kubectl rollout restart deployment/gooaye-summary-app
```

### 3. 檢查上版狀態
您可以透過以下指令確認新版本是否已經成功啟動：
```bash
# 查看滾動更新的進度
kubectl rollout status deployment/gooaye-summary-app

# 如果新版本有問題需要退回上一版 (Rollback)
kubectl rollout undo deployment/gooaye-summary-app
```

> **注意**：請記得將指令中的 `r76021061/gooaye-summary` 替換成您實際的 Docker Hub 帳號與 Image 名稱。

---

## 🌟 終極省錢大絕招：無痛轉移至 Cloud Run (強烈推薦)

如果您發現 GKE 的 **Cloud Monitoring (監控)** 與 **Networking (網路)** 費用過高（例如每天高達 $10~$20 美金），這是因為 GKE 預設會開啟大量的系統監控日誌，且 Load Balancer 與 Cloud NAT 都有高額的固定月費。

為了一個小型的定時摘要機器人，維護一整個 GKE 叢集成本太高。**強烈建議將服務轉移到 Google Cloud Run**，您可以獲得以下好處：
1. **網路費幾乎 $0**：內建免費 HTTPS 網址與負載平衡，免收 Load Balancer 基本費與 Cloud NAT 費用。
2. **監控費幾乎 $0**：沒有 K8s 底層繁雜的網路崩潰 Log。
3. **運算費幾乎 $0 (Scale to Zero)**：沒人看網頁時，機器會自動縮減到 0 台，完全不收費。

### 🚀 Cloud Run 部署步驟

**步驟 1：部署 Image 到 Cloud Run**
在您的 Cloud Shell 中執行以下指令（請替換為您的環境變數）：
```bash
gcloud run deploy gooaye-summary \
  --image r76021061/gooaye-summary:v3.3.1 \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars="GEMINI_API_KEY=您的API_KEY,SMTP_HOST=您的SMTP,SMTP_USER=您的信箱,SMTP_PASS=您的密碼,CRON_EMAILS=r76021061@gmail.com"
```
*(部署完成後，系統會提供一個 `https://gooaye-summary-xxx.run.app` 的免費網址)*

**步驟 2：設定 Cloud Scheduler (取代 K8s CronJob)**
因為 Cloud Run 沒人訪問時會休眠，我們需要使用 GCP 免費的 Cloud Scheduler 來定時觸發後端更新。
1. 進入 GCP 控制台搜尋 **Cloud Scheduler**，建立一個任務。
2. **頻率：** `*/30 * * * *` (每 30 分鐘)
3. **目標類型：** HTTP
4. **URL：** `https://您的Cloud-Run-網址/api/trigger-cron`
5. **HTTP 方法：** POST
6. **Body：** `{"channelId": "gooaye_videos"}` (為每個頻道建立一個 Scheduler 即可)

**步驟 3：刪除 GKE 叢集**
確認 Cloud Run 運作正常、信件也能收到後，您可以**把整個 GKE 叢集刪除**。刪除後，您的 Monitor 和 Network 費用將會瞬間掉到 $0 附近！
