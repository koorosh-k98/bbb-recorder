require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cron = require("node-cron");
const { spawn } = require("child_process");
const { copyToPath } = require("./env");
const FOLDER_TO_WATCH = copyToPath;
const MAX_FILES = 8;
const RECORD_TIME = 0; // Seconds (0 means the whole session)
const matcher = ["matcher.txt"];
const recipients = ["recipients.txt"];

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


async function deleteFromFile(filePath, fileName) {
    let lines = (await fsp.readFile(filePath, "utf-8")).split("\n");

    let remainedLines = lines.filter(line => {
        const parts = line.split(",");
        return fileName != parts[1]
    })

    await fsp.writeFile(filePath, remainedLines.join("\n") + "\n");
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
    const child = spawn("node", ["export.js", url, filename + ".webm", RECORD_TIME, false]);

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
            await deleteFromFile(matcher[0], filename)
            await deleteFromFile(recipients[0], filename)
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

        await bot.api.sendDocument(process.env.CREATOR_CHAT_ID, new InputFile(filePath), {
            caption: `📹 ${fileName} - ${username}`
        });
    }
}

async function sendFileToUsers() {
    const matcherContent = await fsp.readFile(matcher[0], "utf-8");
    const recipientsContent = await fsp.readFile(recipients[0], "utf-8");

    let matcherLines = matcherContent.split("\n").filter(Boolean);
    let recipientsLines = recipientsContent.split("\n").filter(Boolean);

    // Build a map: url → current recorded filename
    const matcherMap = new Map();
    for (const line of matcherLines) {
        const [url, name] = line.split(",").map(s => s.trim());
        if (url && name) matcherMap.set(url, name);
    }

    const stillPendingRecipients = [];
    let hasSentAnything = false;

    for (const line of recipientsLines) {
        const [rUrl, rFileName, rChatId] = line.split(",").map(s => s.trim());
        if (!rUrl || !rFileName || !rChatId) {
            stillPendingRecipients.push(line);
            continue;
        }

        const recordedName = matcherMap.get(rUrl);
        if (!recordedName) {
            stillPendingRecipients.push(line);
            continue;
        }

        const oldFileName = recordedName + ".webm";
        const newFileName = rFileName + ".webm";
        const oldPath = path.join(FOLDER_TO_WATCH, oldFileName);
        const newPath = path.join(FOLDER_TO_WATCH, newFileName);

        if (!fs.existsSync(oldPath)) {
            stillPendingRecipients.push(line);
            continue;
        }

        // Success! File exists → rename and send
        await fsp.rename(oldPath, newPath);
        await sendFileToUser(rChatId, newPath, rFileName);
        hasSentAnything = true;

        // Update matcher: this URL now has the final name
        matcherMap.set(rUrl, rFileName);
    }

    // Only write files back if something actually changed
    if (hasSentAnything) {
        const newMatcherLines = Array.from(matcherMap.entries())
            .map(([url, name]) => `${url},${name}`);

        await fsp.writeFile(matcher[0], newMatcherLines.join("\n") + "\n");
        await fsp.writeFile(recipients[0], stillPendingRecipients.join("\n") + "\n");
    }
}

async function readFromQueue(qPath) {
    let line = await readFirstLine(qPath);
    if (!line) return;

    const [date, time, chatId, fileName, url, isRecordingStr] = line.split(",");
    const isRecording = isRecordingStr.trim() === "true";

    const recordedFilePath = path.join(copyToPath, fileName + ".webm");

    // File ready
    if (fs.existsSync(recordedFilePath)) {
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
        let files = await fsp.readdir(FOLDER_TO_WATCH);

        // Filter out directories, keep only files
        let fileStats = await Promise.all(
            files.map(async (file) => {
                const fullPath = path.join(FOLDER_TO_WATCH, file);
                const stats = await fsp.stat(fullPath);
                return stats.isFile() ? { name: file, path: fullPath, mtime: stats.mtime } : null;
            })
        );

        let validFiles = fileStats.filter(Boolean).sort((a, b) => b.mtime - a.mtime); // Newest first

        if (validFiles.length <= MAX_FILES) return;

        const filesToDelete = validFiles.slice(MAX_FILES);
        console.log(`Found ${validFiles.length} files → deleting ${filesToDelete.length} oldest...`);

        for (const file of filesToDelete) {
            //Delete file
            await fsp.unlink(file.path);

            // Delete from matcher as well
            let fileName = file.name.replace(".webm", "")
            await deleteFromFile(matcher[0], fileName);
        }
        console.log(`Cleanup complete. Now keeping ${MAX_FILES} newest files.\n`);
    } catch (err) {
        console.error('Error during cleanup:', err.message);
    }
}

// Every Five Minutes "*/5 * * * *"
cron.schedule("*/5 * * * *", async () => {
    await handleQueues();
    await sendFileToUsers()
    await cleanupOldFiles();
});