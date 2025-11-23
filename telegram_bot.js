require('dotenv').config();
const { Bot } = require('grammy');
const { conversations, createConversation } = require('@grammyjs/conversations');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const logFile = fs.createWriteStream(path.join(__dirname, 'telegram_bot.log'), { flags: 'a' });
const queues = ["queue.txt"];

function log(message) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" });
  const logMessage = `[${timestamp}] ${message}\n`;
  logFile.write(logMessage);
}

async function lineCount(qPath) {
  try {
    const content = (await fsp.readFile(qPath, "utf-8")).trim();
    if (!content) return 0;
    return content.split("\n").length;
  } catch {
    return 0;
  }
}


async function addToQueue(chatId, filename, url) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Tehran" });
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


  await fsp.appendFile(queues[0], content);
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

  const ask = async (question) => {
    await ctx.reply(question, { parse_mode: "Markdown" });
    const responseCtx = await conversation.waitFor(":text");
    const text = responseCtx.message.text.trim();

    if (text.toLowerCase() === "/cancel") {
      await responseCtx.reply("🚫 Operation cancelled.\nUse /record to start again.");
      throw new Error("Cancelled");
    }

    return text;
  };

  try {
    const sessionNumber = await ask("1️⃣ Session Number:");
    const teacherName = await ask("2️⃣ Teacher name:");
    const courseName = await ask("3️⃣ Course name:");
    const url = await ask("4️⃣ Recording URL:");

    await ctx.reply("✅ Added to recording queue...\n\nUse /record to start recording another BBB session.");

    const time = new Date().toISOString().split('T')[0];
    const finalFileName = `${sessionNumber}_${teacherName}_${courseName}_${time}`;

    await addToQueue(ctx.chat.id, finalFileName, url);
  } catch (err) {
    if (err.message !== "Cancelled") {
      log(err);
      await ctx.reply(`❌ Error: ${err.message}`);
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
