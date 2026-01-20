const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ================== SYSTEM STATE ==================
let lastQrBase64 = null;
let connectionStatus = "initializing";
let qrGenerated = false;

let lastStateChange = Date.now();
let loadingSince = null;

let loadingPercent = null;
let loadingMessage = null;

// ================== STATUS HELPER ==================
function setStatus(newStatus) {
    if (connectionStatus !== newStatus) {
        connectionStatus = newStatus;
        lastStateChange = Date.now();
        console.log(`SERVER ==> STATUS: ${newStatus}`);
    }
}

// ================== WHATSAPP CLIENT ==================
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "User1_Whatsapp_Session" }), 
    puppeteer: {
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        ],
        timeout: 60000
    }
});

// ================== EVENTS ==================

// QR Generated
client.on('qr', async (qr) => {
    console.log('SERVER ==> QR CODE GENERATED');
    qrcodeTerminal.generate(qr, { small: true });

    try {
        lastQrBase64 = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 1,
            scale: 10
        });
        qrGenerated = true;
        setStatus("qr");
    } catch (err) {
        console.error('SERVER ==> QR generation failed:', err);
        lastQrBase64 = null;
    }
});

// Authenticated
client.on('authenticated', () => {
    console.log('SERVER ==> Authenticated successfully');
    lastQrBase64 = null;
    qrGenerated = false;
    setStatus("authenticated");
});


// Ready
client.on('ready', async () => {
    console.log('SERVER ==> WhatsApp READY');
     // SAFETY PATCH (prevents markedUnread crash)
    try {
        await client.pupPage.evaluate(() => {
            if (window.WWebJS?.sendSeen) {
                window.WWebJS.sendSeen = async () => {};
            }
        });
        console.log('SERVER ==> sendSeen patched');
    } catch (e) {
        console.warn('SERVER ==> sendSeen patch failed');
    }
    lastQrBase64 = null;
    qrGenerated = false;
    loadingSince = null;
    setStatus("ready");
});

// Loading
client.on('loading_screen', (percent, message) => {
    if (!loadingSince) loadingSince = Date.now();
    loadingPercent = percent;
    loadingMessage = message;
    console.log(`SERVER ==> Loading ${percent}% - ${message}`);
    setStatus("loading");
});

// Auth Failure
client.on('auth_failure', (msg) => {
    console.error('SERVER ==> Auth failure:', msg);
    lastQrBase64 = null;
    qrGenerated = false;
    setStatus("failure");
});

// Disconnected (NO auto restart)
client.on('disconnected', (reason) => {
    console.log('SERVER ==> Disconnected:', reason);
    lastQrBase64 = null;
    qrGenerated = false;
    setStatus("disconnected");
});

// ================== API ==================

app.get('/qr', (req, res) => {
    res.json({
        status: connectionStatus,
        qr: lastQrBase64,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        whatsappStatus: connectionStatus,
        lastStateChange,
        loadingDuration: loadingSince ? Date.now() - loadingSince : 0,
        loadingPercent,
        loadingMessage,
        qrAvailable: qrGenerated,
        serverTime: new Date().toISOString()
    });
});

app.post('/check-number', async (req, res) => {
    if (connectionStatus !== "ready") {
        return res.status(400).json({
            error: 'WhatsApp is not ready',
            currentStatus: connectionStatus
        });
    }

    try {
        const { number } = req.body;

        if (!number)
            return res.status(400).json({ error: 'Phone number is required' });

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

        const isRegistered = await client.isRegisteredUser(chatId);

        if (!isRegistered) {
            return res.status(404).json({
                registered: false,
                error: 'Number does not have WhatsApp'
            });
        }

        return res.json({ registered: true });

    } catch (err) {
        return res.status(500).json({
            error: 'Unable to verify number'
        });
    }
});

const processedMessages = new Set();

app.post('/send', async (req, res) => {

    if (connectionStatus !== "ready") {
        return res.status(400).json({
            error: 'WhatsApp is not ready'
        });
    }

    try {
        const { messageId, number, message, pdfPath, caption } = req.body;

        if (!messageId)
            return res.status(400).json({ error: 'MessageID is required' });

        // To stop sending the same message again
        if (processedMessages.has(messageId)) {
            return res.json({
                success: true,
                duplicate: true
            });
        }

        processedMessages.add(messageId);

        if (!number)
            return res.status(400).json({ error: 'Phone number is required' });

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

        if (message) {
            await client.sendMessage(chatId, message);
        }

        if (pdfPath) {
            const media = MessageMedia.fromFilePath(pdfPath);
            await client.sendMessage(chatId, media, {
                caption: caption || ''
            });
        }

        return res.json({ success: true });

    } catch (err) {
        console.error('SERVER ==> Send Error:', err);
        return res.status(500).json({
            error: err.message
        });
    }
});

// ================== INIT ==================

let initializing = false;

setTimeout(() => {
    if (initializing) return;

    initializing = true;
    console.log('SERVER ==> Initializing WhatsApp client...');

    client.initialize().catch(err => {
        console.error('SERVER ==> Initialization failed:', err);
        setStatus("error");
        initializing = false;
    });
}, 2000);

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`SERVER ==> API running on http://localhost:${PORT}`);
});
