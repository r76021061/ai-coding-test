import https from 'https';

https.get('https://www.youtube.com/@Gooaye', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const match = data.match(/channel_id=([^"&]+)/) || data.match(/"channelId":"([^"]+)"/);
    console.log("Channel ID:", match ? match[1] : "Not found");
  });
});
