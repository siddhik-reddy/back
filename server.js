const express = require('express');
const axios = require('axios');
const JSSoup = require('jssoup').default;
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for React Native
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Subject class
class Subject {
    constructor(subjectCode, subjectName, internal, external, total, grade, credits) {
        this.subjectCode = subjectCode;
        this.subjectName = subjectName;
        this.internal = internal;
        this.external = external;
        this.total = total;
        this.grade = grade;
        this.credits = credits;
    }
}

// Global variables
let examCodes = {};

const JNTUH_URLS = {
    HOME_IP: 'http://202.63.105.184/results/jsp/home.jsp',
    RESULT_IP: 'http://202.63.105.184/results/resultAction',
    HOME_DOMAIN: 'http://results.jntuh.ac.in/jsp/home.jsp',
    RESULT_DOMAIN: 'http://results.jntuh.ac.in/resultAction'
};

// Comprehensive exam codes from R18 to present (R24)
const COMPREHENSIVE_EXAM_CODES = {
    "1-1": ["1323", "1358", "1404", "1430", "1467", "1504", "1540", "1572", "1597", "1615", "1632", "1647", "1660", "1675", "1690"],
    "1-2": ["1356", "1363", "1381", "1435", "1448", "1481", "1503", "1525", "1570", "1590", "1620", "1622", "1640", "1655", "1670", "1685"],
    "2-1": ["1391", "1425", "1449", "1496", "1520", "1560", "1585", "1610", "1628", "1645", "1665", "1680"],
    "2-2": ["1437", "1447", "1476", "1501", "1530", "1565", "1595", "1605", "1627", "1650", "1675", "1695"],
    "3-1": ["1454", "1491", "1535", "1550", "1575", "1590", "1626", "1639", "1645", "1655", "1670", "1688"],
    "3-2": ["1502", "1545", "1555", "1580", "1595", "1625", "1638", "1649", "1654", "1668", "1685", "1698"],
    "4-1": ["1545", "1585", "1600", "1624", "1640", "1644", "1653", "1670", "1682", "1692"],
    "4-2": ["1580", "1600", "1615", "1623", "1635", "1648", "1658", "1675", "1688", "1695"]
};

// Supported regulations
const SUPPORTED_REGULATIONS = ['R18', 'R20', 'R22', 'R24'];

function ensureDataDir() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
}

async function initExamCodes() {
    const dataDir = ensureDataDir();
    const codesFile = path.join(dataDir, 'codes.json');
    
    try {
        if (fs.existsSync(codesFile)) {
            const cachedData = JSON.parse(fs.readFileSync(codesFile, 'utf8'));
            const cacheDate = new Date(cachedData.date);
            const now = new Date();
            const hoursSinceCache = (now - cacheDate) / (1000 * 60 * 60);
            
            // Use cache if less than 6 hours old
            if (hoursSinceCache < 6) {
                examCodes = cachedData.codes;
                console.log('Loaded exam codes from cache');
                console.log(`Cache age: ${hoursSinceCache.toFixed(1)} hours`);
                return;
            }
        }
    } catch (error) {
        console.warn('Error reading cached codes:', error.message);
    }
    
    // Try to fetch fresh codes
    console.log('Fetching latest exam codes from JNTUH website...');
    try {
        await fetchExamCodesFromWebsite();
        console.log('Successfully fetched latest exam codes');
    } catch (error) {
        console.warn('Failed to fetch from JNTUH website:', error.message);
        console.log('Using comprehensive exam codes list...');
        examCodes = JSON.parse(JSON.stringify(COMPREHENSIVE_EXAM_CODES));
        saveCodesToCache(examCodes);
    }
}

function saveCodesToCache(codes) {
    try {
        const dataDir = ensureDataDir();
        const codesFile = path.join(dataDir, 'codes.json');
        const cacheData = {
            date: new Date().toISOString(),
            codes: codes
        };
        fs.writeFileSync(codesFile, JSON.stringify(cacheData, null, 2));
        console.log('Saved exam codes to cache');
    } catch (error) {
        console.warn('Could not save codes:', error.message);
    }
}

async function fetchExamCodesFromWebsite() {
    const axiosConfig = {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };
    
    const urlsToTry = [
        { url: JNTUH_URLS.HOME_IP, name: 'IP-based URL' },
        { url: JNTUH_URLS.HOME_DOMAIN, name: 'domain-based URL' }
    ];
    
    for (let { url, name } of urlsToTry) {
        try {
            console.log(`Trying ${name}: ${url}`);
            const response = await axios.get(url, axiosConfig);
            
            const soup = new JSSoup(response.data);
            const tables = soup.findAll('table');
            
            if (!tables || tables.length === 0) {
                console.warn(`No tables found on ${name}`);
                continue;
            }
            
            const trs = tables[0].findAll('tr');
            
            const codesDictionary = {
                "1-1": [], "1-2": [], "2-1": [], "2-2": [],
                "3-1": [], "3-2": [], "4-1": [], "4-2": []
            };
            
            const semesterMapping = {
                " I Year I ": "1-1", " I Year II": "1-2",
                " II Year I ": "2-1", " II Year II": "2-2",
                " III Year I ": "3-1", " III Year II": "3-2",
                " IV Year I ": "4-1", " IV Year II": "4-2"
            };
            
            let codesFound = 0;
            
            trs.forEach(tr => {
                try {
                    const tds = tr.findAll('td');
                    if (!tds || tds.length === 0) return;
                    
                    const td = tds[0];
                    const links = td.findAll('a');
                    if (!links || links.length === 0) return;
                    
                    const link = links[0].attrs.href;
                    const codePos = link.search('examCode=');
                    if (codePos === -1) return;
                    
                    const code = link.substring(codePos + 9, codePos + 13);
                    
                    // Accept ALL regulations from R18 onwards
                    const tdText = td.text;
                    const matchesRegulation = SUPPORTED_REGULATIONS.some(reg => tdText.includes(reg));
                    
                    if (matchesRegulation) {
                        for (let semesterString in semesterMapping) {
                            if (tdText.includes(semesterString)) {
                                const semester = semesterMapping[semesterString];
                                if (!codesDictionary[semester].includes(code)) {
                                    codesDictionary[semester].push(code);
                                    codesFound++;
                                }
                                break;
                            }
                        }
                    }
                } catch (err) {
                    // Skip invalid rows
                }
            });
            
            // Sort all codes
            for (let key in codesDictionary) {
                codesDictionary[key] = [...new Set(codesDictionary[key])].sort();
            }
            
            // Merge with comprehensive codes for complete coverage
            for (let semester in COMPREHENSIVE_EXAM_CODES) {
                const existingCodes = new Set(codesDictionary[semester]);
                COMPREHENSIVE_EXAM_CODES[semester].forEach(code => {
                    if (!existingCodes.has(code)) {
                        codesDictionary[semester].push(code);
                    }
                });
                codesDictionary[semester].sort();
            }
            
            if (codesFound > 0) {
                examCodes = codesDictionary;
                saveCodesToCache(codesDictionary);
                console.log(`Fetched ${codesFound} new exam codes using ${name}`);
                return;
            }
            
        } catch (error) {
            console.warn(`Failed to fetch from ${name}:`, error.message);
            continue;
        }
    }
    
    throw new Error('Failed to fetch exam codes from all URLs');
}

function parseSubjects(response) {
    try {
        const data = response.data || '';
        
        if (data.length < 1500) return null;
        if (data.includes('No Student Record Found') || 
            data.includes('No Records Found') ||
            data.includes('Invalid Hall Ticket') ||
            data.includes('Enter HallTicket Number') ||
            data.includes('Hall Ticket Number')) return null;
        
        const soup = new JSSoup(data);
        const tables = soup.findAll("table");
        
        if (!tables || tables.length < 2) return null;
        
        // Parse subjects
        const subjects = [];
        const subjectTable = tables[1];
        const trs = subjectTable.findAll("tr");
        
        if (!trs || trs.length < 2) return null;
        
        // Find column indices from header
        const headerRow = trs[0];
        const headerCells = headerRow.findAll("td") || headerRow.findAll("th");
        
        let colMap = {};
        headerCells.forEach((cell, index) => {
            const text = cell.text.trim().toUpperCase();
            if (text.includes('SUBJECT CODE')) colMap.subjectCode = index;
            if (text.includes('SUBJECT NAME')) colMap.subjectName = index;
            if (text.includes('INTERNAL')) colMap.internal = index;
            if (text.includes('EXTERNAL')) colMap.external = index;
            if (text.includes('TOTAL')) colMap.total = index;
            if (text.includes('GRADE')) colMap.grade = index;
            if (text.includes('CREDIT')) colMap.credits = index;
        });
        
        // Fallback to default positions if columns not found
        if (Object.keys(colMap).length < 7) {
            colMap = {
                subjectCode: 0, subjectName: 1, internal: 2,
                external: 3, total: 4, grade: 5, credits: 6
            };
        }
        
        for (let i = 1; i < trs.length; i++) {
            const tds = trs[i].findAll("td");
            if (!tds || tds.length < 7) continue;
            
            const subjectCode = (tds[colMap.subjectCode]?.text || '').trim();
            const subjectName = (tds[colMap.subjectName]?.text || '').trim();
            
            if (subjectCode && subjectName) {
                subjects.push(new Subject(
                    subjectCode,
                    subjectName,
                    (tds[colMap.internal]?.text || '0').trim(),
                    (tds[colMap.external]?.text || '0').trim(),
                    (tds[colMap.total]?.text || '0').trim(),
                    (tds[colMap.grade]?.text || 'F').trim(),
                    (tds[colMap.credits]?.text || '0').trim()
                ));
            }
        }
        
        if (subjects.length === 0) return null;
        
        // Parse student info
        const infoTable = tables[0];
        const infoTrs = infoTable.findAll("tr");
        
        if (!infoTrs || infoTrs.length === 0) return null;
        
        const infoTds = infoTrs[0].findAll("td");
        const fatherTds = infoTrs[1] ? infoTrs[1].findAll("td") : [];
        
        if (!infoTds || infoTds.length < 4) return null;
        
        // Extract exam code from URL
        const requestUrl = response.config?.url || '';
        const examCodeMatch = requestUrl.match(/examCode=(\d{4})/);
        const examCode = examCodeMatch ? parseInt(examCodeMatch[1]) : null;
        
        return {
            name: (infoTds[3]?.text || '').trim() || 'Unknown',
            htno: (infoTds[1]?.text || '').trim() || 'Unknown',
            fatherName: fatherTds.length >= 2 ? (fatherTds[1]?.text || '').trim() : '',
            collegeCode: fatherTds.length >= 4 ? (fatherTds[3]?.text || '').trim() : '',
            subjects: subjects,
            examCode: examCode
        };
        
    } catch (error) {
        console.error('Parse error:', error.message);
        return null;
    }
}

async function getSingleResult(htno, examCode = null) {
    const config = {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 15000
    };
    
    if (!examCode) {
        const lastSemCodes = examCodes["4-2"] || COMPREHENSIVE_EXAM_CODES["4-2"];
        examCode = lastSemCodes[lastSemCodes.length - 1];
    }
    
    const urlsToTry = [
        { url: JNTUH_URLS.RESULT_IP, name: 'IP-based' },
        { url: JNTUH_URLS.RESULT_DOMAIN, name: 'domain-based' }
    ];
    
    for (let { url } of urlsToTry) {
        try {
            // Regular result
            const regularUrl = `${url}?degree=btech&examCode=${examCode}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`;
            const response = await axios.get(regularUrl, config);
            
            if (response.data && response.data.length > 1500) {
                const result = parseSubjects(response);
                if (result && result.subjects && result.subjects.length > 0) {
                    return result;
                }
            }
            
            // Revaluation result
            const revalUrl = `${url}?degree=btech&examCode=${examCode}&etype=r17&result=gradercrv&grad=null&type=rcrvintgrade&htno=${htno}`;
            const revalResponse = await axios.get(revalUrl, config);
            
            if (revalResponse.data && revalResponse.data.length > 1500) {
                const result = parseSubjects(revalResponse);
                if (result && result.subjects && result.subjects.length > 0) {
                    return result;
                }
            }
            
        } catch (error) {
            continue;
        }
    }
    
    throw new Error('No results found for this hall ticket number');
}

async function getAllResults(htno) {
    const config = {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 15000
    };
    
    const isLateralEntry = htno.length >= 5 && htno[4] === '5';
    const promises = [];
    
    for (let semester in examCodes) {
        if (isLateralEntry && (semester === "1-1" || semester === "1-2")) {
            continue;
        }
        
        for (let code of examCodes[semester]) {
            promises.push({
                semester,
                code,
                type: 'regular',
                promise: axios.get(`${JNTUH_URLS.RESULT_IP}?degree=btech&examCode=${code}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`, config)
                    .catch(() => axios.get(`${JNTUH_URLS.RESULT_DOMAIN}?degree=btech&examCode=${code}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`, config))
                    .catch(() => null)
            });
            
            promises.push({
                semester,
                code,
                type: 'revaluation',
                promise: axios.get(`${JNTUH_URLS.RESULT_IP}?degree=btech&examCode=${code}&etype=r17&result=gradercrv&grad=null&type=rcrvintgrade&htno=${htno}`, config)
                    .catch(() => axios.get(`${JNTUH_URLS.RESULT_DOMAIN}?degree=btech&examCode=${code}&etype=r17&result=gradercrv&grad=null&type=rcrvintgrade&htno=${htno}`, config))
                    .catch(() => null)
            });
        }
    }
    
    console.log(`Fetching ${promises.length} requests for ${htno}...`);
    
    const batchSize = 8;
    const results = [];
    
    for (let i = 0; i < promises.length; i += batchSize) {
        const batch = promises.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (item) => {
                const response = await item.promise;
                return { ...item, response };
            })
        );
        results.push(...batchResults);
        
        if (i + batchSize < promises.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    const validResults = results.filter(item => {
        if (!item.response || !item.response.data) return false;
        if (item.response.data.length < 1500) return false;
        if (item.response.data.includes('No Student Record Found') ||
            item.response.data.includes('Invalid') ||
            item.response.data.includes('Enter HallTicket Number') ||
            item.response.data.includes('Hall Ticket Number')) return false;
        return true;
    });
    
    console.log(`Found ${validResults.length} valid responses`);
    
    const parsedMap = new Map();
    
    for (let item of validResults) {
        const parsed = parseSubjects(item.response);
        if (parsed && parsed.examCode) {
            const key = `${parsed.examCode}_${item.semester}`;
            if (!parsedMap.has(key) || item.type === 'revaluation') {
                parsedMap.set(key, parsed);
            }
        }
    }
    
    const finalResults = Array.from(parsedMap.values());
    finalResults.sort((a, b) => a.examCode - b.examCode);
    
    console.log(`Parsed ${finalResults.length} unique semester results`);
    
    if (finalResults.length === 0) {
        throw new Error('No results found. Check hall ticket number or try refreshing exam codes.');
    }
    
    return finalResults;
}

// Routes

// Health check
app.get('/', (req, res) => {
    let totalCodes = 0;
    for (let semester in examCodes) {
        totalCodes += examCodes[semester].length;
    }
    
    res.json({
        status: 'online',
        service: 'JNTUH Results API',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        examCodesLoaded: totalCodes,
        semesters: Object.keys(examCodes).length,
        supportedRegulations: SUPPORTED_REGULATIONS,
        endpoints: {
            health: 'GET /',
            singleResult: 'POST /api/single',
            allResults: 'POST /api/all',
            refreshCodes: 'POST /api/refresh-codes',
            viewCodes: 'GET /api/codes',
            testConnection: 'GET /api/test'
        }
    });
});

// View exam codes
app.get('/api/codes', (req, res) => {
    let totalCodes = 0;
    for (let semester in examCodes) {
        totalCodes += examCodes[semester].length;
    }
    
    res.json({
        total: totalCodes,
        supportedRegulations: SUPPORTED_REGULATIONS,
        lastUpdated: new Date().toISOString(),
        semesters: examCodes
    });
});

// Single result
app.post('/api/single', async (req, res) => {
    try {
        const { htno, examCode } = req.body;
        if (!htno) {
            return res.status(400).json({ error: 'Hall ticket number is required' });
        }
        
        const result = await getSingleResult(htno, examCode || null);
        res.json(result);
    } catch (error) {
        console.error('Single result error:', error.message);
        res.status(404).json({ error: error.message || 'No results found' });
    }
});

// All results
app.post('/api/all', async (req, res) => {
    try {
        const { htno } = req.body;
        if (!htno) {
            return res.status(400).json({ error: 'Hall ticket number is required' });
        }
        
        const results = await getAllResults(htno);
        res.json(results);
    } catch (error) {
        console.error('All results error:', error.message);
        res.status(404).json({ error: error.message || 'No results found' });
    }
});

// Refresh exam codes
app.post('/api/refresh-codes', async (req, res) => {
    try {
        await fetchExamCodesFromWebsite();
        
        let totalCodes = 0;
        for (let semester in examCodes) {
            totalCodes += examCodes[semester].length;
        }
        
        res.json({ 
            message: 'Exam codes refreshed successfully from JNTUH website',
            total: totalCodes,
            semesters: Object.keys(examCodes).length,
            codes: examCodes,
            refreshedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Refresh error:', error.message);
        
        // Use comprehensive codes as fallback
        examCodes = JSON.parse(JSON.stringify(COMPREHENSIVE_EXAM_CODES));
        saveCodesToCache(examCodes);
        
        res.status(200).json({ 
            message: 'Could not reach JNTUH website. Using comprehensive offline codes.',
            total: Object.keys(examCodes).reduce((sum, sem) => sum + examCodes[sem].length, 0),
            codes: examCodes,
            warning: 'Codes may not be the latest. Try refreshing later.'
        });
    }
});

// Test JNTUH connection
app.get('/api/test', async (req, res) => {
    const result = {
        jntuhWebsite: false,
        ipBased: false,
        domainBased: false,
        message: ''
    };
    
    try {
        await axios.get(JNTUH_URLS.HOME_IP, { timeout: 5000 });
        result.ipBased = true;
    } catch (e) {}
    
    try {
        await axios.get(JNTUH_URLS.HOME_DOMAIN, { timeout: 5000 });
        result.domainBased = true;
    } catch (e) {}
    
    result.jntuhWebsite = result.ipBased || result.domainBased;
    result.message = result.jntuhWebsite ? 
        'JNTUH website is accessible' : 
        'JNTUH website is not accessible right now';
    
    res.json(result);
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
    try {
        console.log('Starting JNTUH Results API v2.0...');
        console.log(`Supported regulations: ${SUPPORTED_REGULATIONS.join(', ')}`);
        
        await initExamCodes();
        
        let totalCodes = 0;
        for (let semester in examCodes) {
            totalCodes += examCodes[semester].length;
        }
        
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server running on port ${port}`);
            console.log(`Loaded ${totalCodes} exam codes across ${Object.keys(examCodes).length} semesters`);
            console.log(`Supported regulations: ${SUPPORTED_REGULATIONS.join(', ')}`);
        });
    } catch (error) {
        console.error('Startup error:', error.message);
        examCodes = JSON.parse(JSON.stringify(COMPREHENSIVE_EXAM_CODES));
        
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server started with comprehensive codes on port ${port}`);
        });
    }
}

process.on('SIGINT', () => { console.log('Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });

startServer();
