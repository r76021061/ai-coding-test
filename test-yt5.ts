import https from "https";

https.get('https://www.youtube.com/@yutinghaofinance/videos', (res) => {
  console.log("STATUS:", res.statusCode);
});
