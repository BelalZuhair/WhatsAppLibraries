// ================== Baileys-based WhatsApp Server ==================
// Converted from whatsapp-web.js version
// Logic, endpoints, and behavior preserved

const path = require('path');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ================== SYSTEM STATE ==================
let sock = null;
let lastQrBase64 = null;
let connectionStatus = 'initializing';
let qrGenerated = false;
let lastStateChange = Date.now();
let loadingSince = null;
let loadingPercent = null;
let loadingMessage = null;

const processedMessages = new Set();

// ================== STATUS HELPER ==================
function setStatus(newStatus) {
    if (connectionStatus !== newStatus) {
        connectionStatus = newStatus;
        lastStateChange = Date.now();
        console.log(`SERVER ==> STATUS: ${newStatus}`);
    }
}

// ================== WHATSAPP INIT ==================
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Windows', 'Chrome', '120']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            console.log('SERVER ==> QR CODE GENERATED');
            lastQrBase64 = await QRCode.toDataURL(qr, { margin: 1, scale: 10 });
            qrGenerated = true;
            setStatus('qr');
        }

        if (connection === 'open') {
            console.log('SERVER ==> WhatsApp READY');
            lastQrBase64 = null;
            qrGenerated = false;
            loadingSince = null;
            setStatus('ready');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log('SERVER ==> Disconnected:', reason);

            qrGenerated = false;
            lastQrBase64 = null;
            setStatus('disconnected');

            if (reason !== DisconnectReason.loggedOut) {
                startWhatsApp(); // auto-reconnect
            } else {
                setStatus('logged_out');
            }
        }
    });
}

startWhatsApp().catch(err => {
    console.error('SERVER ==> Initialization failed:', err);
    setStatus('error');
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

// ================== CHECK NUMBER ==================
app.post('/check-number', async (req, res) => {
    if (connectionStatus !== 'ready') {
        return res.status(400).json({
            error: 'WhatsApp is not ready',
            currentStatus: connectionStatus
        });
    }

    try {
        const { number } = req.body;
        if (!number) return res.status(400).json({ error: 'Phone number is required' });

        const jid = `${number}@s.whatsapp.net`;
        const result = await sock.onWhatsApp(jid);

        if (!result || result.length === 0) {
            return res.status(404).json({
                registered: false,
                error: 'Number does not have WhatsApp'
            });
        }

        return res.json({ registered: true });
    } catch (err) {
        return res.status(500).json({ error: 'Unable to verify number' });
    }
});

// ================== SEND MESSAGE ==================
app.post('/send', async (req, res) => {
    if (connectionStatus !== 'ready') {
        return res.status(400).json({ error: 'WhatsApp is not ready' });
    }

    try {
        const { messageId, number, message, pdfPath, caption } = req.body;

        if (!messageId)
            return res.status(400).json({ error: 'MessageID is required' });

        if (processedMessages.has(messageId)) {
            return res.json({ success: true, duplicate: true });
        }

        processedMessages.add(messageId);

        if (!number)
            return res.status(400).json({ error: 'Phone number is required' });

        const jid = `${number}@s.whatsapp.net`;

        if (message) {
            await sock.sendMessage(jid, { text: message });
        }

        if (pdfPath) {
            const fileBuffer = fs.readFileSync(pdfPath);
            const fileName = path.basename(pdfPath);

            await sock.sendMessage(jid, {
                document: fs.readFileSync(pdfPath),
                mimetype: 'application/pdf',
                fileName: fileName,
                caption: caption || ''
            });
            /*
            await sock.sendMessage(jid, {
                document: fileBuffer,
                mimetype: 'application/pdf',
                fileName: pdfPath.split('/').pop(),
                caption: caption || ''
            });
            */
        }

        return res.json({ success: true });

    } catch (err) {
        console.error('SERVER ==> Send Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// ================== SERVER ==================
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`SERVER ==> API running on http://localhost:${PORT}`);
});
