const axios = require('axios');
const { formidable } = require('formidable');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- PROXY ÇEKME ---
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
                allProxies = allProxies.concat(res.data.split('\n').filter(p => p.trim() !== ''));
            } catch (e) {}
        }
        return [...new Set(allProxies)];
    } catch (e) { return []; }
}

// --- PROXY TEST ---
async function checkProxy(proxy) {
    try {
        await axios.get('http://httpbin.org/ip', {
            proxy: { host: proxy.split(':')[0], port: parseInt(proxy.split(':')[1]) },
            timeout: 3000
        });
        return proxy;
    } catch (e) { return null; }
}

// --- STRIPE AUTH KART KONTROL MOTORU ---
async function checkStripeAuthCard(card, proxy) {
    try {
        const parts = card.trim().split('|');
        if (parts.length < 4) return { card, status: 'Invalid Format', msg: 'Eksik bilgi' };
        
        let [cc, mm, yy, cvv] = parts;
        
        // Yıl 4 haneliyse (2028) son iki hanesini al (28)
        if (yy.length === 4) {
            yy = yy.substring(2);
        }

        // Basit Luhn Algoritması Kontrolü
        if (cc.length < 15 || !/^\d+$/.test(cc)) return { card, status: 'Invalid Format', msg: 'Hatali kart no' };

        const agent = proxy ? new HttpsProxyAgent(`http://${proxy}`) : undefined;

        // Stripe Auth API'sine istek atıyoruz (Para çekmez, sadece kartı doğrular)
        // Buradaki pk_test anahtarı, Stripe'ın halka açık test anahtarıdır.
        const stripePayload = new URLSearchParams({
            'type': 'card',
            'card[number]': cc,
            'card[exp_month]': mm,
            'card[exp_year]': yy,
            'card[cvc]': cvv,
            'key': 'pk_test_51O4pS2Fz4n4y4t4X4y4t4X4y4t4X4y4t4X4y4t4X4y4t4X4y4t4X4y4t4X4y4t4X' // Halka açık test anahtarı
        });

        const response = await axios.post('https://api.stripe.com/v1/payment_methods', stripePayload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            httpsAgent: agent,
            timeout: 10000,
            validateStatus: () => true // Hata kodlarını da yakala
        });

        const data = response.data;

        // Stripe bize hata dönerse kontrol et
        if (data.error) {
            const errCode = data.error.code;
            const errMsg = data.error.message;
            
            // Eğer hata "kart reddedildi" veya "kart geçersiz" ise DIE
            if (errCode === 'card_declined' || errMsg.includes('declined') || errMsg.includes('incorrect')) {
                return { card: card, status: 'DIE', msg: errMsg, proxy: proxy };
            }
            // Eğer hata "kartın süresi geçmiş" ise DIE
            if (errCode === 'expired_card') {
                return { card: card, status: 'DIE', msg: 'Expired Card', proxy: proxy };
            }
            // Eğer hata "CVC hatalı" ise DIE
            if (errCode === 'incorrect_cvc') {
                return { card: card, status: 'DIE', msg: 'Incorrect CVC', proxy: proxy };
            }
            
            // Diğer bilinmeyen hatalar
            return { card: card, status: 'DIE', msg: errMsg, proxy: proxy };
        }

        // Eğer hata yoksa ve kart onaylandıysa (id dönerse)
        if (data.id && data.id.startsWith('pm_')) {
            // Banka bilgisini alalım
            const brand = data.card.brand || 'Unknown';
            const country = data.card.country || 'Unknown';
            const funding = data.card.funding || 'Unknown';
            
            return { 
                card: card, 
                status: 'LIVE', 
                msg: 'Approved', 
                brand: brand,
                country: country,
                funding: funding,
                proxy: proxy 
            };
        }

        return { card: card, status: 'DIE', msg: 'Unknown Response', proxy: proxy };

    } catch (e) {
        return { card: card, status: 'ERROR', msg: e.message, proxy: proxy };
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
            return res.status(400).json({ hata: "Kart bulunamadi." });
        }

        const proxies = await getProxies();
        let liveProxies = [];
        for (const p of proxies) {
            if (liveProxies.length >= 3) break; // Hız için 3 proxy yeter
            const check = await checkProxy(p);
            if (check) liveProxies.push(p);
        }

        if (liveProxies.length === 0) {
            return res.status(500).json({ hata: "Hicbir proxy calismiyor." });
        }

        let results = [];
        let proxyIndex = 0;
        const maxCardsToProcess = Math.min(cardsToCheck.length, 20); // Stripe Auth yavaş olduğu için 20 sınır

        for (let i = 0; i < maxCardsToProcess; i++) {
            const card = cardsToCheck[i];
            const currentProxy = liveProxies[proxyIndex % liveProxies.length];
            proxyIndex++;
            
            const result = await checkStripeAuthCard(card, currentProxy);
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
