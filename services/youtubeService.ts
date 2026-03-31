import https from "https";

export interface VideoInfo {
  title: string;
  videoId: string;
  url: string;
  date: string;
}

/**
 * Fetches the latest video (or stream) from a YouTube channel page.
 * Parses ytInitialData from the HTML response — no API key required.
 */
export function fetchLatestVideo(
  channelHandle: string,
  type: string,
): Promise<VideoInfo | null> {
  return new Promise((resolve, reject) => {
    const tabName = type === "streams" ? "streams" : "videos";
    const url = `https://www.youtube.com/${channelHandle}/${tabName}`;

    const request = https
      .get(url, (ytRes) => {
        let data = "";
        ytRes.on("data", (chunk) => (data += chunk));
        ytRes.on("end", () => {
          try {
            const match = data.match(
              /var ytInitialData = (\{.*?\});<\/script>/,
            );
            if (!match) {
              resolve(null);
              return;
            }

            const json = JSON.parse(match[1]);
            const tabs =
              json.contents.twoColumnBrowseResultsRenderer.tabs;
            const videosTab = tabs.find(
              (t: any) =>
                t.tabRenderer &&
                t.tabRenderer.content &&
                t.tabRenderer.content.richGridRenderer,
            );

            if (!videosTab) {
              resolve(null);
              return;
            }

            const items =
              videosTab.tabRenderer.content.richGridRenderer.contents;
            const latestItem = items.find(
              (i: any) =>
                i.richItemRenderer &&
                i.richItemRenderer.content &&
                i.richItemRenderer.content.videoRenderer,
            );

            if (latestItem) {
              const v = latestItem.richItemRenderer.content.videoRenderer;
              resolve({
                title: v.title?.runs?.[0]?.text || "Unknown Title",
                videoId: v.videoId,
                url: "https://www.youtube.com/watch?v=" + v.videoId,
                date: v.publishedTimeText?.simpleText || "",
              });
            } else {
              resolve(null);
            }
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);

    // 10-second timeout
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error("YouTube fetch timeout"));
    });
  });
}

/**
 * Fetches and returns multiple recent videos for a channel.
 */
export function fetchRecentVideos(
  channelHandle: string,
  type: string,
): Promise<VideoInfo[]> {
  return new Promise((resolve, reject) => {
    const tabName = type === "streams" ? "streams" : "videos";
    const url = `https://www.youtube.com/${channelHandle}/${tabName}`;

    const request = https
      .get(url, (ytRes) => {
        let data = "";
        ytRes.on("data", (chunk) => (data += chunk));
        ytRes.on("end", () => {
          try {
            const match = data.match(
              /var ytInitialData = (\{.*?\});<\/script>/,
            );
            if (!match) {
              resolve([]);
              return;
            }

            const json = JSON.parse(match[1]);
            const tabs =
              json.contents.twoColumnBrowseResultsRenderer.tabs;
            const videosTab = tabs.find(
              (t: any) =>
                t.tabRenderer &&
                t.tabRenderer.content &&
                t.tabRenderer.content.richGridRenderer,
            );

            if (!videosTab) {
              resolve([]);
              return;
            }

            const items =
              videosTab.tabRenderer.content.richGridRenderer.contents;

            const videos: VideoInfo[] = items
              .filter(
                (i: any) =>
                  i.richItemRenderer &&
                  i.richItemRenderer.content &&
                  i.richItemRenderer.content.videoRenderer,
              )
              .map((i: any) => {
                const v = i.richItemRenderer.content.videoRenderer;
                return {
                  title: v.title?.runs?.[0]?.text || "Unknown Title",
                  videoId: v.videoId,
                  url: "https://www.youtube.com/watch?v=" + v.videoId,
                  date: v.publishedTimeText?.simpleText || "",
                };
              });

            resolve(videos);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);

    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error("YouTube fetch timeout"));
    });
  });
}
