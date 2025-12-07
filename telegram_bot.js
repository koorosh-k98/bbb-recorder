require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const { conversations, createConversation } = require('@grammyjs/conversations');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { copyToPath } = require("./env");
const FOLDER_TO_WATCH = copyToPath;

const logFile = fs.createWriteStream(path.join(__dirname, 'telegram_bot.log'), { flags: 'a' });
const queues = ["queue.txt"];
const matcher = ["matcher.txt"];
const recipients = ["recipients.txt"];

function log(message) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" });
  const logMessage = `[${timestamp}] ${message}\n`;
  logFile.write(logMessage);
}

// async function lineCount(qPath) {
//   try {
//     const content = (await fsp.readFile(qPath, "utf-8")).trim();
//     if (!content) return 0;
//     return content.split("\n").length;
//   } catch {
//     return 0;
//   }
// }


async function addToQueue(chatId, filename, url) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" });
  const matcherContent = `${url},${filename}`;
  const content = `[${timestamp}],${chatId},${filename},${url},false\n`;

  // let queuesLine = [];
  // // Adds to the file which has fewer lines
  // for (let i = 0; i < queues.length; i++) {
  //   queuesLine[i] = await lineCount(queues[i])
  // }

  // let minLines = queuesLine[0];
  // let queue = queues[0];


  // for (let i = 0; i < queues.length; i++) {
  //   if (queuesLine[i] < minLines) {
  //     minLines = queuesLine[i];
  //     queue = queues[i]
  //   }
  // }

  // await fsp.appendFile(queue, content);

  // Unique matcher content based on url
  let lines = (await fsp.readFile(matcher[0], "utf-8")).trim().split("\n");
  const alreadyMatched = lines.some(line => line.startsWith(url + ","));

  if (!alreadyMatched) {
    await fsp.appendFile(matcher[0], matcherContent + "\n");
  }

  // Add it to recipients
  const c = `${url},${filename},${chatId}`;
  await fsp.appendFile(recipients[0], c + "\n");

  lines = (await fsp.readFile(queues[0], "utf-8")).trim().split("\n");
  const alreadyRecording = lines.some(line => {
    const [date, time, chatId, fileName, recordUrl, isRecordingStr] = line.split(",");
    return recordUrl === url;
  });

  let files = await fsp.readdir(FOLDER_TO_WATCH);
  let newFileExists = files.includes(filename + ".webm")
  lines = (await fsp.readFile(matcher[0], "utf-8")).trim().split("\n");
  let oldFileExists = lines.some(line => {
    const parts = line.split(",");
    if (parts[0] === url) {
      return files.includes(parts[1] + ".webm")
    }
    return false;
  })

  if (!alreadyRecording && !newFileExists && !oldFileExists) {
    await fsp.appendFile(queues[0], content);
  }
}

const token = process.env.BOT_TOKEN?.trim();
if (!token) {
  console.error("BOT_TOKEN missing!");
  process.exit(1);
}

const bot = new Bot(token, {
  client: {
    apiRoot: "http://127.0.0.1:8081",
  },
});

bot.use(conversations());

async function bbbRecordingConversation(conversation, ctx) {
  await ctx.reply("✨ *BBB Recording Wizard Started!*\n\nSend /cancel anytime to stop.", { parse_mode: "Markdown" });

  const ask = async (question, field) => {
    await ctx.reply(question, { parse_mode: "Markdown" });
    const responseCtx = await conversation.waitFor(":text");
    let text = responseCtx.message.text.trim();

    if (text.toLowerCase() === "/cancel") {
      await responseCtx.reply("🚫 Operation cancelled.\nUse /record to start again.");
      throw new Error("Cancelled");
    }

    const validateNumber = (value) => {
      if (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 1000000) return value;
      throw new Error("Invalid number! Must be positive integer. [1-1000000]");
    }

    const validateText = (value) => {
      if (/^[a-zA-Z0-9\s'-]{1,40}$/.test(value)) return value.replace(/\s+/g, " ");
      throw new Error("Invalid input! Only letters and numbers, max 40 chars.");
    }

    const validateUrl = (value) => {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
          throw new Error("Invalid URL! Must start with https://");
        }
        return value;
      } catch {
        throw new Error("Invalid URL! Must start with https://");
      }
    }

    switch (field) {
      case "sessionNumber":
        text = await validateNumber(text);
        break;
      case "teacherName":
      case "courseName":
        text = await validateText(text)
        break;
      case "url":
        text = await validateUrl(text)
        break;
      default:
        throw new Error("Unknown field");
    }

    return text;
  };

  try {
    const sessionNumber = await ask("1️⃣ Session Number:", "sessionNumber");
    const teacherName = await ask("2️⃣ Teacher name:", "teacherName");
    const courseName = await ask("3️⃣ Course name:", "courseName");
    const url = await ask("4️⃣ Recording URL:", "url");

    await ctx.reply("✅ Added to recording queue...\n\nUse /record to start recording another BBB session.");

    const time = new Date().toISOString().split('T')[0];
    const finalFileName = `${sessionNumber}_${teacherName}_${courseName}_${time}`;

    await addToQueue(ctx.chat.id, finalFileName, url);
  } catch (err) {
    if (err.message !== "Cancelled") {
      log(err);
      await ctx.reply(`❌ Error: ${err.message}\n\nUse /record to start recording a new BBB session.`);
    }
  }
}

bot.use(createConversation(bbbRecordingConversation));
bot.command("start", (ctx) => ctx.reply("Welcome! Use /record to start recording a BBB session."));
bot.command("record", async (ctx) => {
  await ctx.conversation.enter("bbbRecordingConversation");
});

bot.start();
console.log("BBB Recording Bot is running! 🚀");
