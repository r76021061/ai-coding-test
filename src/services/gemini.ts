export const summarizeVideo = async (
  channelName: string,
  videoUrl: string,
  videoTitle?: string,
) => {
  if (!videoUrl) {
    return { text: "請提供影片連結。", sources: [] };
  }

  try {
    const channelId =
      channelName === "股癌"
        ? "gooaye"
        : channelName === "財經皓角"
          ? "finance_hao"
          : channelName === "郭哲榮分析師"
            ? "kuo_che_jung"
            : "unknown";

    const cacheRes = await fetch(
      `/api/summary?url=${encodeURIComponent(videoUrl)}&channelId=${channelId}&channelName=${encodeURIComponent(channelName)}`,
    );
    if (cacheRes.ok) {
      const cacheData = await cacheRes.json();
      return { text: cacheData.summary, sources: [] };
    } else {
      console.warn("Cache miss or error, status:", cacheRes.status);
      return { text: "無法取得資料，請稍後再試。", sources: [] };
    }
  } catch (error: any) {
    console.error("Error calling summarize API:", error);
    return { text: "系統發生錯誤，請稍後再試。", sources: [] };
  }
};
