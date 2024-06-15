const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const { DiscordNotification } = require("@penseapp/discord-notification");
require("dotenv").config();
const cron = require("node-cron");

const lastNewsTimestampPath = process.env.DATA_PATH;

const dateTimeRegex =
  /Cập nhật ngày (\d{2}\/\d{2}\/\d{4}) - (\d{2}:\d{2}:\d{2})/;
const parseDateTimeTextToTimestamp = (datetimeText) => {
  const match = datetimeText.match(dateTimeRegex);
  if (match) {
    const date = match[1];
    const time = match[2];
    // Combine date and time into a single string and parse it
    const [day, month, year] = date.split("/");
    const [hours, minutes, seconds] = time.split(":");
    const dateObj = new Date(year, month - 1, day, hours, minutes, seconds);
    return dateObj.getTime();
  }
  return 0;
};

async function crawl() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(process.env.VSD_ENDPOINT);

  // Fetch all the results
  const results = await page.$$("#d_list_news .list-news > li");

  if (results.length > 0) {
    // Extract the div content from the first result outside the loop
    const latestDiv = results[0];
    const extractDateTimeContent = await page.evaluate((el) => {
      const div = el.querySelector("div");
      return div ? div.textContent : null;
    }, latestDiv);
    const timestamp = parseDateTimeTextToTimestamp(extractDateTimeContent);

    let previousTimestamp = 0;
    if (fs.existsSync(lastNewsTimestampPath)) {
      const fileContent = fs.readFileSync(lastNewsTimestampPath, "utf8");
      previousTimestamp = parseInt(fileContent, 10);
    }
    if (timestamp <= previousTimestamp) {
      console.log("No newest news");
    } else {
      // Save the timestamp to a file
      fs.outputFileSync(lastNewsTimestampPath, timestamp.toString());
      let allNews = [];
      // Loop through all the results and process them
      for (const result of results) {
        let news = await page.evaluate((el) => {
          const anchor = el.querySelector("h3 > a");
          return {
            title: anchor ? anchor.textContent : null,
            href: anchor ? anchor.href : null,
          };
        }, result);
        const newsTimeText = await page.evaluate((el) => {
          const div = el.querySelector("div");
          return div ? div.textContent : null;
        }, result);
        const resultTime = parseDateTimeTextToTimestamp(newsTimeText);
        news["time"] = resultTime;
        if (resultTime > previousTimestamp) {
          news["time"] = resultTime;
          allNews.push(news);
        } else {
          break;
        }
      }
      console.log(`Number of news since last time: ${allNews.length}`);
      const newsInMarkdown = allNews
        .map((news) => {
          return `**${news.title}**\n[View more](${news.href})`;
        })
        .join("\n\n");
      const discordNotification = new DiscordNotification(
        "VSD News",
        process.env.DISCORD_WEBHOOK,
      );
      discordNotification
        .infoMessage()
        .addContent("@everyone Tin tức chứng khoán từ VSD")
        .addDescription(newsInMarkdown)
        .sendMessage();
    }
  }

  await browser.close();
}
cron.schedule(process.env.CRON_TIME, async () => {
  await crawl();
});
