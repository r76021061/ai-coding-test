# Gooaye Summary App - Kubernetes 部署指南

👉 **[查看開發日誌 (Changelog)](./CHANGELOG.md)**

本專案包含將「股癌/游庭皓影片摘要服務」部署至 Kubernetes (K8s) 的相關設定檔。

## 部署流程

### 1. 建立敏感資訊 Secret (非常重要)
因為應用程式啟動時需要讀取 API Key 與 SMTP 密碼，如果沒有先建立 Secret，Pod 啟動時會因為抓不到環境變數而直接 Crash。
請**務必在 apply 其他 yaml 檔案之前**，先在您的 K8s 叢集中執行以下指令建立 Secret：

```bash
kubectl create secret generic gooaye-secrets \
  --from-literal=GEMINI_API_KEY="您的_GEMINI_API_KEY" \
  --from-literal=SMTP_USER="您的_GMAIL_帳號" \
  --from-literal=SMTP_PASS="您的_GMAIL_應用程式密碼"
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

當您修改了程式碼並需要重新部署時，請依照以下流程：

### 1. 在本機打包並上傳 Image
```bash
# 建立 Docker Image (請將 r76021061 替換為您的帳號)
docker build -t r76021061/gooaye-summary:latest .

# 推送到 Docker Hub
docker push r76021061/gooaye-summary:latest
```

### 2. 在 K8s 節點更新服務
到能控制 K8s 的節點上：
```bash
# 取得最新程式碼
git clone <您的專案網址> project
cd project

# 重新套用設定檔 (如果有修改 yaml 的話)
kubectl apply -f ./gke/pvc.yaml
kubectl apply -f ./gke/deployment.yaml
kubectl apply -f ./gke/configmap.yaml
kubectl apply -f ./gke/cronjob.yaml
kubectl apply -f ./gke/service.yaml

# 強制讓 Deployment 重新拉取最新的 Image 並重啟 Pod
kubectl rollout restart deployment gooaye-summary-app
```

> **注意**：請記得先將 `gke/deployment.yaml` 內的 `image: r76021061/gooaye-summary:latest` 替換成您實際的 Docker Hub 帳號與 Image 名稱。
