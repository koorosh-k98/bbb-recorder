require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cron = require("node-cron");
const { spawn } = require("child_process");
const { copyToPath } = require("./env");
const FOLDER_TO_WATCH = copyToPath;
const MAX_FILES = 10;
const matcher = ["matcher.txt"];

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
    const child = spawn("node", ["export.js", url, filename + ".webm", 10, false]);

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

    if (chatId != process.env.CREATOR_CHAT_ID) {

        const user = await bot.api.getChat(chatId);
        const username = user.username ? `@${user.username}` : "no username";

        await bot.api.sendDocument(process.env.CREATOR_CHAT_ID, new InputFile(requestedFilePath), {
            caption: `📹 ${fileName} - ${username}`
        });
    }
    // fs.unlinkSync(filePath)
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

async function cleanupOldFiles() {
    try {
        const files = await fsp.readdir(FOLDER_TO_WATCH);

        // Filter out directories, keep only files
        const fileStats = await Promise.all(
            files.map(async (file) => {
                const fullPath = path.join(FOLDER_TO_WATCH, file);
                const stats = await fsp.stat(fullPath);
                return stats.isFile() ? { name: file, path: fullPath, mtime: stats.mtime } : null;
            })
        );

        const validFiles = fileStats
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime); // Newest first

        if (validFiles.length <= MAX_FILES) {
            console.log(`Only ${validFiles.length} files → nothing to delete`);
            return;
        }

        const filesToDelete = validFiles.slice(MAX_FILES);
        console.log(`Found ${validFiles.length} files → deleting ${filesToDelete.length} oldest...`);

        for (const file of filesToDelete) {
            try {
                await fsp.unlink(file.path);
                console.log(`Deleted: ${file.name} (modified: ${file.mtime.toLocaleString()})`);
            } catch (err) {
                console.error(`Failed to delete ${file.name}:`, err.message);
            }
        }

        // Delete from matcher as well
        try {
            const remainingFiles = validFiles.slice(0, MAX_FILES);
            const keptNames = remainingFiles.map(f => f.name.replace(".webm", ""));

            let content = await fsp.readFile(matcher[0], "utf-8");
            const lines = content.split("\n");

            const cleanedLines = lines.filter(line => {
                if (!line.trim()) return true;
                const parts = line.split(",");
                if (parts.length < 2) return true;
                return keptNames.includes(parts[1].trim());
            });

            await fsp.writeFile(matcher[0], cleanedLines.join("\n").trim() + "\n");
            console.log(`Matcher file updated → ${cleanedLines.filter(l => l.trim()).length} entries kept`);
        } catch (err) {
            console.error("Failed to update matcher file:", err.message);
        }


        console.log(`Cleanup complete. Now keeping ${MAX_FILES} newest files.\n`);
    } catch (err) {
        console.error('Error during cleanup:', err.message);
    }
}

// cron.schedule("*/15 * * * * *", async () => {
//     await handleQueues();
//     await cleanupOldFiles();
// });

cron.schedule("*/5 * * * *", async () => {
    await handleQueues();
    await cleanupOldFiles();
});