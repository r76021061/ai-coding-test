import https from "https";

https.get('https://www.youtube.com/@yutinghaofinance/streams', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (match) {
      const json = JSON.parse(match[1]);
      const tabs = json.contents.twoColumnBrowseResultsRenderer.tabs;
      const streamsTab = tabs.find((t: any) => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.richGridRenderer);
      if (streamsTab) {
        const items = streamsTab.tabRenderer.content.richGridRenderer.contents;
        const videos = items.filter((i: any) => i.richItemRenderer).map((i: any) => {
          const v = i.richItemRenderer.content.videoRenderer;
          return v ? v.title.runs[0].text : null;
        });
        console.log(videos.slice(0, 3));
      } else {
        console.log("No streamsTab");
      }
    } else {
      console.log("No ytInitialData");
    }
  });
});
