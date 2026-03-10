import https from 'https';
import fs from 'fs';

https.get('https://www.youtube.com/@Gooaye/videos', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const match = data.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (match) {
      fs.writeFileSync('yt.json', match[1]);
      console.log("Saved to yt.json");
    }
  });
});
