import https from 'https';

https.get('https://www.youtube.com/feeds/videos.xml?channel_id=UC23rnlQU_qE3cec9x709peA', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data.substring(0, 500));
  });
});
