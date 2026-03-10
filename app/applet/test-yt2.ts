import https from "https";

https.get('https://www.youtube.com/@youtinghao/videos', (res) => {
  console.log("STATUS:", res.statusCode);
  console.log("LOCATION:", res.headers.location);
});
