import fs from 'fs';

const data = JSON.parse(fs.readFileSync('yt.json', 'utf8'));
const tabs = data.contents.twoColumnBrowseResultsRenderer.tabs;
const videosTab = tabs.find(t => t.tabRenderer && t.tabRenderer.content && t.tabRenderer.content.richGridRenderer);
const items = videosTab.tabRenderer.content.richGridRenderer.contents;

const videos = items.filter(i => i.richItemRenderer).map(i => {
  const v = i.richItemRenderer.content.videoRenderer;
  return {
    title: v.title.runs[0].text,
    url: 'https://www.youtube.com/watch?v=' + v.videoId,
    date: v.publishedTimeText?.simpleText
  };
});

console.log(videos.slice(0, 3));
