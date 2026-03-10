import https from 'https';

https.get('https://www.youtube.com/@Gooaye/videos', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (match) {
      const json = JSON.parse(match[1]);
      console.log("Found ytInitialData");
      // Try to find videos
      try {
        const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
        const videosTab = tabs.find(t => t.tabRenderer.title === 'Videos' || t.tabRenderer.title === '影片');
        const items = videosTab.tabRenderer.content.richGridRenderer.contents;
        const videos = items.filter(item => item.richItemRenderer).map(item => {
          const video = item.richItemRenderer.content.videoRenderer;
          return {
            title: video.title.runs[0].text,
            url: 'https://www.youtube.com/watch?v=' + video.videoId,
            date: video.publishedTimeText?.simpleText
          };
        });
        console.log(videos.slice(0, 3));
      } catch (e) {
        console.error("Error parsing videos", e);
      }
    } else {
      console.log("Not found");
    }
  });
});
