const axios = require('axios');
const { formidable } = require('formidable');
const fs = require('fs');

// --- SINIRSIZ PROXY ÇEKME ---
async function getProxies() {
    try {
        const urls = [
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
            'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
        ];
        
        let allProxies = [];
        for (const url of urls) {
            try {
                const res = await axios.get(url, { timeout: 4000 });
                const list = res.data.split('\n').filter(p => p.trim() !== '');
                allProxies = allProxies.concat(list);
            } catch (e) {}
        }

        const uniqueProxies = [...new Set(allProxies)];
        return uniqueProxies;
    } catch (e) { return []; }
}

// --- PROXY TEST ---
async function checkProxy(proxy) {
    try {
        const start = Date.now();
        await axios.get('http://httpbin.org/ip', {
            proxy: { host: proxy.split(':')[0], port: parseInt(proxy.split(':')[1]) },
            timeout: 3000 
        });
        return { proxy, time: Date.now() - start };
    } catch (e) { return null; }
}

// --- KART KONTROL ---
async function checkCard(card, proxy) {
    try {
        const parts = card.trim().split('|');
        if (parts.length < 4) return { card, status: 'Invalid Format', msg: 'Eksik bilgi' };
        const [cc, mm, yy, cvv] = parts;
        if (cc.length < 15 || mm.length !== 2 || yy.length < 2 || cvv.length < 3) {
            return { card, status: 'Invalid Format', msg: 'Hatali format' };
        }

        // Gerçek API istek simülasyonu
        const isLive = Math.random() > 0.8; 
        
        if (isLive) return { card, status: 'LIVE', msg: 'Approved', proxy: proxy };
        return { card, status: 'DIE', msg: 'Declined', proxy: proxy };
    } catch (e) {
        return { card, status: 'ERROR', msg: e.message };
    }
}

// --- ANA HANDLER ---
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    let cardsToCheck = [];

    try {
        if (req.method === 'POST' && req.headers['content-type']?.includes('multipart/form-data')) {
            const form = formidable({ multiples: false });
            const [fields, files] = await form.parse(req);
            const uploadedFile = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null;
            
            if (uploadedFile) {
                const fileContent = fs.readFileSync(uploadedFile.filepath, 'utf8');
                cardsToCheck = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            } else if (fields.cards) {
                cardsToCheck = (Array.isArray(fields.cards) ? fields.cards[0] : fields.cards).split(',');
            }
        } else {
            const cardsParam = req.query.cards || (req.body && req.body.cards);
            if (cardsParam) cardsToCheck = cardsParam.split(',');
        }

        if (cardsToCheck.length === 0) {
            return res.status(400).json({ hata: "Kart bulunamadi. URL'ye ?cards=... ekleyin veya dosya yukleyin." });
        }

        const proxies = await getProxies();
        let liveProxies = [];
        
        for (const p of proxies) {
            if (liveProxies.length >= 5) break;
            const check = await checkProxy(p);
            if (check) liveProxies.push(p);
        }

        if (liveProxies.length === 0) {
            return res.status(500).json({ hata: "Hicbir proxy calismiyor." });
        }

        let results = [];
        let proxyIndex = 0;
        
        const maxCardsToProcess = Math.min(cardsToCheck.length, 100); 

        for (let i = 0; i < maxCardsToProcess; i++) {
            const card = cardsToCheck[i];
            const currentProxy = liveProxies[proxyIndex % liveProxies.length];
            proxyIndex++;
            
            const result = await checkCard(card, currentProxy);
            results.push(result);
        }

        return res.status(200).json({
            success: true,
            total_gelen: cardsToCheck.length,
            islenen: results.length,
            live: results.filter(r => r.status === 'LIVE').length,
            die: results.filter(r => r.status === 'DIE').length,
            results: results
        });

    } catch (error) {
        return res.status(500).json({ hata: "Sunucu hatasi", detay: error.message });
    }
};
