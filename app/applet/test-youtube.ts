import https from "https";

https.get('https://www.youtube.com/@youtinghao/videos', (res) => {
  console.log(res.statusCode, res.headers.location);
});
