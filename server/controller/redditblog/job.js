const { startBrowser, startPage } = require("../helper/browserHelper");
const { scrollPageToBottom } = require("../helper/core");
const { addData } = require("../authController");
const { sanitizeDate } = require("../helper/dateSanitize");
const Queue = require("better-queue");
let page;
let count = 0;
let q = null;

async function redditblog(io) {
  const browser = await startBrowser();
  page = await startPage(browser);

  await page.goto("https://redditblog.com", {
    waitUntil: "networkidle2",
  });
  await scrollPageToBottom(page);
  await page.waitForTimeout(2000);

  async function navigateToNextTab(results) {
    q = new Queue(
      async (data) => {
        if (await addData(data)) {
          count--;
        } else {
          count++;
        }
      },
      { concurrent: results.length }
    );

    for (let result of results) {
      let newTab;
      try {
        newTab = await startPage(browser);
        await newTab.goto(result.content_url, {
          waitUntil: "domcontentloaded",
          timeout: 0,
        });

        console.log("collecting data from next tab..");
        const singleData = await newTab.evaluate(async () => {
          try {
            const regexBody = /(<([^>]+)>)|\n|\t|\s{2,}|"|'/gi;
            const body = document
              .querySelector(".entry-content")
              ?.innerText.replace(regexBody, " ");
            return {
              body: body.substring(0, 350),
              summary: body.substring(0, 150),
              reading_time: body?.length || 400,
            };
          } catch (error) {
            console.log(error);
          }
        });

        result.published_at = sanitizeDate(result.published_at);
        // data storing to db
        q.push({
          ...result,
          ...singleData,
        });
        await newTab.waitForTimeout(2000);
        await newTab.close();
      } catch (error) {
        await newTab.close();
        console.log("navigation error", error);
      }
    }
  }

  async function paginate() {
    try {
      const nextClick = await page.$(".next");
      if (nextClick) {
        console.log("pagination found...");
        //console.log(count);
        await Promise.all([page.click(".next")]);
        await page.waitForTimeout(2000);
        await scrollPageToBottom(page);
        await page.waitForTimeout(2000);
        await collectData();
      } else {
        console.log("Scrapping finished");
        await page.close();
        await browser.close();
        io.emit("work-process", { data: null });
        return false;
      }
    } catch (e) {
      console.log("Pagination Error Found", e);
      await page.close();
      await browser.close();
      io.emit("work-process", { data: null });
      return false;
    }
  }

  async function collectData() {
    try {
      io.emit("work-process", { data: "Schedule Job Starts..." });
      console.log(count);
      if (count > 5) {
        await page.close();
        await browser.close();
        io.emit("work-process", { data: null });
        return false;
      }

      console.log("Data collection started");
      io.emit("work-process", { data: "Working..." });
      let results = await page.evaluate(() => {
        return [...document.querySelectorAll("main article")].map((element) => {
          const authName =
            document.querySelector(".author")?.innerText ?? "redditblog";
          return {
            domain: "redditblog",
            domain_icon_url: document.querySelector("link[rel='icon']")?.href,
            title: element.querySelector("h2")?.innerText,
            content_url: element.querySelector("h2 a")?.href,
            topic: element.querySelector(".article-topic-link")?.innerText,
            published_at: document.querySelector(".posted-on time.published")
              ?.innerText,
            author_name:
              authName.toLowerCase() == "staff" ? "redditblog" : authName,
            images_url:
              document.querySelector(".article-thumbnail img")?.src ??
              "https://www.technobezz.com/files/uploads/2020/06/Reddit-Logo-Horizontal.png",
            content_type: "article",
          };
        });
      });
      if (results.length === 0) {
        console.log("Scrapping finished");
        await page.close();
        await browser.close();
        io.emit("work-process", { data: null });
        return false;
      }

      await navigateToNextTab(results);
      await paginate();
    } catch (e) {
      console.log("error found", e);
    }
  }
  console.log("recheck pagination");
  await collectData();
}

module.exports = {
  redditblog,
};
