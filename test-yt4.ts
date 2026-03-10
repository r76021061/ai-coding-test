import https from "https";

https.get('https://www.youtube.com/results?search_query=游庭皓的財經皓角', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const match = data.match(/@[\w\d_]+/g);
    if (match) {
      console.log(Array.from(new Set(match)).slice(0, 10));
    }
  });
});
