require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cron = require("node-cron");
const { spawn } = require("child_process");
const { copyToPath } = require("./env");

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

console.log("Running...")

const queues = ["queue.txt"];

async function readFirstLine(qPath) {
    try {
        const content = (await fsp.readFile(qPath, "utf-8")).trim();
        if (!content) return null;

        const lines = content.split("\n");
        return lines[0] || null;
    } catch {
        return null;
    }
}

async function deleteFirstLine(qPath) {
    try {
        const content = await fsp.readFile(qPath, "utf-8");
        let lines = content.split("\n");
        lines.splice(0, 1);
        await fsp.writeFile(qPath, lines.join("\n"));
    } catch { }
}

async function setRecording(qPath, value) {
    try {
        let lines = (await fsp.readFile(qPath, "utf-8")).trim().split("\n");
        if (!lines[0]) return;

        let parts = lines[0].split(",");
        parts[5] = value.toString(); // isRecording = true/false
        lines[0] = parts.join(",");

        await fsp.writeFile(qPath, lines.join("\n") + "\n");
    } catch { }
}

function runRecorder(url, filename, chatId, qPath) {
    console.log(url, filename, chatId)
    const child = spawn("node", ["export.js", url, filename + ".webm", 0, false]);

    child.stdout.on("data", async (data) => {
        console.log(`Output: ${data}`);
        await setRecording(qPath, true);
    });

    child.stderr.on("data", async (data) => {
        const err = data.toString().trim();
        console.log(err)
        await bot.api.sendMessage(chatId, `🚫 Error: ${err}\n${filename}\n${url}\n\nUse /record to start another BBB session.`);

        if (err === "Invalid recording URL!" || err === "Recording URL unreachable!") {
            await deleteFirstLine(qPath);
        }
    });

    child.on("close", async () => {
        await setRecording(qPath, false);
    });
}

async function sendFileToUser(chatId, filePath, fileName) {
    await bot.api.sendDocument(chatId, new InputFile(filePath), {
        caption: `📹 ${fileName}`
    });
    fs.unlinkSync(filePath)
}

async function readFromQueue(qPath) {
    let line = await readFirstLine(qPath);
    if (!line) return;

    const [date, time, chatId, fileName, url, isRecordingStr] = line.split(",");
    const isRecording = isRecordingStr.trim() === "true";

    const recordedFilePath = path.join(copyToPath, fileName + ".webm");

    // File ready
    if (fs.existsSync(recordedFilePath)) {
        await sendFileToUser(chatId, recordedFilePath, fileName);
        await deleteFirstLine(qPath);
        return;
    }

    if (isRecording) return;

    await setRecording(qPath, true);
    runRecorder(url, fileName, chatId, qPath);
}

async function handleQueues() {

    // If you had powerful machines that can handle more than one session recording at a time
    // // Argument passed when running the script, defines which queue should be used to record the session
    // const q = process.argv[2];

    // if (q === "1" || q === "2") {
    //     if (q === "1") {
    //         await readFromQueue(queues[0]);
    //     } else {
    //         await readFromQueue(queues[1]);
    //     }
    // }
    // else {
    //     console.log("Invalid argument!")
    //     process.exit(1);
    // }

    await readFromQueue(queues[0]);
}

cron.schedule("*/5 * * * *", async () => {
    await handleQueues();
});