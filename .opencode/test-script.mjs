import puppeteer from "puppeteer-core";

const BROWSER_URL = "http://127.0.0.1:9222";
const TARGET_URL = process.argv[2] || "http://localhost:5173";

async function main() {
  const browser = await puppeteer.connect({
    browserURL: BROWSER_URL,
    defaultViewport: null,
  });

  const pages = await browser.pages();
  console.log(`Connected to browser. ${pages.length} pages open.`);

  let page = pages.find((p) => p.url().includes(TARGET_URL));
  if (!page) {
    page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: "networkidle0", timeout: 15000 });
    console.log(`Navigated to ${TARGET_URL}`);
  } else {
    await page.bringToFront();
    console.log(`Using existing page: ${page.url()}`);
  }

  const title = await page.title();
  const jsErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      jsErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  await new Promise((r) => setTimeout(r, 3000));

  const result = {
    url: page.url(),
    title,
    jsErrors,
  };

  console.log(JSON.stringify(result, null, 2));

  const screenshot = await page.screenshot({ encoding: "base64" });
  console.log(`\nSCREENSHOT_BASE64:${screenshot}`);

  await browser.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
