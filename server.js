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

const FALLBACK_EXAM_CODES = {
    "1-1": ["1323", "1356", "1389", "1422", "1455", "1488"],
    "1-2": ["1324", "1357", "1390", "1423", "1456", "1489"],
    "2-1": ["1325", "1358", "1391", "1424", "1457", "1490"],
    "2-2": ["1326", "1359", "1392", "1425", "1458", "1491"],
    "3-1": ["1327", "1360", "1393", "1426", "1459", "1492"],
    "3-2": ["1328", "1361", "1394", "1427", "1460", "1493"],
    "4-1": ["1329", "1362", "1395", "1428", "1461", "1494"],
    "4-2": ["1330", "1363", "1396", "1429", "1462", "1495"]
};

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
            examCodes = JSON.parse(fs.readFileSync(codesFile, 'utf8'));
            console.log('Loaded exam codes from cache');
            console.log(`Found ${Object.keys(examCodes).length} semesters with codes`);
            return;
        }
    } catch (error) {
        console.warn('Error reading cached codes:', error.message);
    }
    
    console.log('Attempting to fetch exam codes from JNTUH website...');
    try {
        await fetchExamCodes();
        console.log('Successfully fetched exam codes from JNTUH');
    } catch (error) {
        console.warn('Failed to fetch from JNTUH website:', error.message);
        console.log('Using fallback exam codes...');
        
        examCodes = { ...FALLBACK_EXAM_CODES };
        
        try {
            fs.writeFileSync(codesFile, JSON.stringify(examCodes, null, 2));
            console.log('Saved fallback exam codes to cache');
        } catch (saveError) {
            console.warn('Could not save fallback codes:', saveError.message);
        }
    }
}

async function fetchExamCodes() {
    const axiosConfig = {
        timeout: 10000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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
            
            const stringDictionary = {
                " I Year I ": "1-1", " I Year II": "1-2",
                " II Year I ": "2-1", " II Year II": "2-2",
                " III Year I ": "3-1", " III Year II": "3-2",
                " IV Year I ": "4-1", " IV Year II": "4-2"
            };
            
            let codesFound = 0;
            trs.forEach(tr => {
                try {
                    const tds = tr.findAll('td');
                    if (tds && tds.length > 0) {
                        const td = tds[0];
                        const links = td.findAll('a');
                        if (links && links.length > 0 && td.text.includes('R18')) {
                            const link = links[0].attrs.href;
                            const codePos = link.search('examCode=');
                            if (codePos !== -1) {
                                const code = link.substring(codePos + 9, codePos + 13);
                                for (let key in stringDictionary) {
                                    if (td.text.includes(key)) {
                                        codesDictionary[stringDictionary[key]].push(code);
                                        codesFound++;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    // Skip invalid rows
                }
            });
            
            for (let key in codesDictionary) {
                codesDictionary[key] = [...new Set(codesDictionary[key])];
            }
            
            for (let semester in FALLBACK_EXAM_CODES) {
                const existingCodes = new Set(codesDictionary[semester]);
                FALLBACK_EXAM_CODES[semester].forEach(code => {
                    if (!existingCodes.has(code)) {
                        codesDictionary[semester].push(code);
                    }
                });
            }
            
            examCodes = codesDictionary;
            
            const dataDir = ensureDataDir();
            const codesFile = path.join(dataDir, 'codes.json');
            fs.writeFileSync(codesFile, JSON.stringify(codesDictionary, null, 2));
            
            console.log(`Successfully fetched ${codesFound} exam codes using ${name}`);
            return;
            
        } catch (error) {
            console.warn(`Failed to fetch from ${name}:`, error.message);
            continue;
        }
    }
    
    throw new Error('Failed to fetch exam codes from all available URLs');
}

function parseSubjects(response) {
    try {
        console.log('Response status:', response.status);
        console.log('Response data length:', response.data.length);
        
        if (response.data.includes('No Student Record Found') || 
            response.data.includes('Invalid') ||
            response.data.includes('error') ||
            response.data.includes('Error')) {
            console.log('Response contains error message');
            return null;
        }
        
        if (response.data.length < 1500) {
            console.log('Response too short, likely an error page');
            return null;
        }
        
        const soup = new JSSoup(response.data);
        const tables = soup.findAll("table");
        
        console.log('Found tables:', tables ? tables.length : 0);
        
        if (!tables || tables.length < 2) {
            console.log('Invalid response format - insufficient tables');
            
            const bodyText = soup.text || '';
            if (bodyText.includes('No Student Record Found')) {
                throw new Error('No Student Record Found');
            } else if (bodyText.includes('Invalid')) {
                throw new Error('Invalid Hall Ticket Number or Exam Code');
            } else {
                throw new Error('Invalid response format - expected result tables not found');
            }
        }
        
        const subjects = [];
        const subjectTable = tables[1];
        const trs = subjectTable.findAll("tr");
        
        if (!trs || trs.length < 2) {
            console.log('Subject table has insufficient rows');
            throw new Error('No subject data found in response');
        }
        
        trs.forEach((tr, index) => {
            if (index === 0) return;
            
            const tds = tr.findAll("td");
            if (tds && tds.length >= 7) {
                const subjectCode = tds[0].text.trim();
                const subjectName = tds[1].text.trim();
                
                if (subjectCode && subjectName) {
                    subjects.push(new Subject(
                        subjectCode,
                        subjectName,
                        tds[2].text.trim(),
                        tds[3].text.trim(),
                        tds[4].text.trim(),
                        tds[5].text.trim(),
                        tds[6].text.trim()
                    ));
                }
            }
        });
        
        if (subjects.length === 0) {
            console.log('No valid subjects found');
            throw new Error('No valid subject data found');
        }
        
        const infoTable = tables[0];
        const infoTrs = infoTable.findAll("tr");
        
        if (!infoTrs || infoTrs.length === 0) {
            throw new Error('Student information not found');
        }
        
        const infoTds = infoTrs[0].findAll("td");
        
        if (!infoTds || infoTds.length < 4) {
            throw new Error('Invalid student information format');
        }
        
        const requestData = response.config.data;
        const examCodeMatch = requestData.match(/examCode=([0-9]{4})/);
        const examCode = examCodeMatch ? parseInt(examCodeMatch[1]) : null;
        
        const result = {
            name: infoTds[3].text.trim(),
            htno: infoTds[1].text.trim(),
            subjects: subjects,
            examCode: examCode
        };
        
        console.log(`Successfully parsed ${subjects.length} subjects for ${result.htno}`);
        return result;
        
    } catch (error) {
        console.error('Error parsing subjects:', error.message);
        return null;
    }
}

async function getSingleResult(htno, examCode = 1495) {
    const config = {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 15000
    };
    
    const postData = {
        "degree": "btech",
        "etype": "r17",
        "result": "null",
        "grad": "null",
        "examCode": examCode.toString(),
        "type": "intgrade",
        "htno": htno
    };
    
    const urlsToTry = [
        { url: JNTUH_URLS.RESULT_IP, name: 'IP-based URL' },
        { url: JNTUH_URLS.RESULT_DOMAIN, name: 'domain-based URL' }
    ];
    
    let lastError = null;
    
    for (let { url, name } of urlsToTry) {
        try {
            console.log(`Fetching result using ${name} for ${htno} with exam code ${examCode}`);
            
            const response = await axios.post(url, postData, config);
            
            if (!response.data || response.data.length < 500) {
                console.warn(`Short response from ${name}: ${response.data ? response.data.length : 0} bytes`);
                continue;
            }
            
            if (response.data.includes('No Student Record Found')) {
                console.log(`No record found using ${name} for exam code ${examCode}`);
                lastError = new Error(`No Student Record Found for exam code ${examCode}`);
                continue;
            }
            
            if (response.data.includes('Invalid')) {
                console.log(`Invalid response from ${name} for exam code ${examCode}`);
                lastError = new Error(`Invalid request for exam code ${examCode}`);
                continue;
            }
            
            const result = parseSubjects(response);
            if (result && result.subjects && result.subjects.length > 0) {
                console.log(`Successfully fetched result using ${name}`);
                return result;
            } else {
                console.warn(`Failed to parse valid result from ${name}`);
                lastError = new Error(`Failed to parse result from ${name}`);
            }
            
        } catch (error) {
            console.warn(`Error with ${name}:`, error.message);
            lastError = error;
            continue;
        }
    }
    
    throw lastError || new Error('Failed to fetch result from all available URLs');
}

async function getAllResults(htno) {
    const config = {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 15000
    };
    
    let resultUrl = JNTUH_URLS.RESULT_IP;
    
    const promises = [];
    let totalRequests = 0;
    
    for (let semester in examCodes) {
        for (let code of examCodes[semester]) {
            // Regular results
            promises.push(
                axios.post(resultUrl, {
                    "degree": "btech",
                    "etype": "r17",
                    "result": "null",
                    "grad": "null",
                    "examCode": code,
                    "type": "intgrade",
                    "htno": htno
                }, config).catch(err => {
                    if (resultUrl === JNTUH_URLS.RESULT_IP) {
                        return axios.post(JNTUH_URLS.RESULT_DOMAIN, {
                            "degree": "btech",
                            "etype": "r17",
                            "result": "null",
                            "grad": "null",
                            "examCode": code,
                            "type": "intgrade",
                            "htno": htno
                        }, config).catch(() => null);
                    }
                    return null;
                })
            );
            
            // Revaluation results
            promises.push(
                axios.post(resultUrl, {
                    "degree": "btech",
                    "etype": "r17",
                    "result": "gradercrv",
                    "grad": "null",
                    "examCode": code,
                    "type": "rcrvintgrade",
                    "htno": htno
                }, config).catch(err => {
                    if (resultUrl === JNTUH_URLS.RESULT_IP) {
                        return axios.post(JNTUH_URLS.RESULT_DOMAIN, {
                            "degree": "btech",
                            "etype": "r17",
                            "result": "gradercrv",
                            "grad": "null",
                            "examCode": code,
                            "type": "rcrvintgrade",
                            "htno": htno
                        }, config).catch(() => null);
                    }
                    return null;
                })
            );
            totalRequests += 2;
        }
    }
    
    console.log(`Fetching ${totalRequests} results for ${htno}...`);
    
    const batchSize = 6;
    const results = [];
    
    for (let i = 0; i < promises.length; i += batchSize) {
        const batch = promises.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(promises.length/batchSize)}`);
        
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
        
        if (i + batchSize < promises.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    const validResults = results.filter(result => {
        if (!result || !result.data) return false;
        if (result.data.length < 1500) return false;
        if (result.data.includes('No Student Record Found') ||
            result.data.includes('Invalid') ||
            result.data.includes('error')) return false;
        if (result.headers && result.headers['content-length'] === '3774') return false;
        return true;
    });
    
    console.log(`Found ${validResults.length} valid responses out of ${totalRequests} requests`);
    
    const parsedResults = [];
    const seenCodes = new Set();
    let parseErrors = 0;
    
    for (let result of validResults) {
        const parsed = parseSubjects(result);
        if (parsed && parsed.examCode && !seenCodes.has(parsed.examCode) && parsed.subjects.length > 0) {
            parsedResults.push(parsed);
            seenCodes.add(parsed.examCode);
        } else if (!parsed) {
            parseErrors++;
        }
    }
    
    if (parseErrors > 0) {
        console.log(`${parseErrors} responses could not be parsed`);
    }
    
    parsedResults.sort((a, b) => a.examCode - b.examCode);
    
    console.log(`Successfully parsed ${parsedResults.length} unique results for ${htno}`);
    
    if (parsedResults.length === 0) {
        throw new Error('No valid results found. This could mean:\n1. Hall ticket number is incorrect\n2. No results are available for this student\n3. JNTUH website is experiencing issues');
    }
    
    return parsedResults;
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'JNTUH Results API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /',
            singleResult: 'POST /api/single',
            allResults: 'POST /api/all',
            refreshCodes: 'POST /api/refresh-codes'
        }
    });
});

// API endpoint for single result
app.post('/api/single', async (req, res) => {
    try {
        const { htno } = req.body;
        if (!htno) {
            return res.status(400).json({ error: 'Hall ticket number is required' });
        }
        
        const result = await getSingleResult(htno);
        if (result) {
            res.json(result);
        } else {
            res.status(404).json({ error: 'No results found' });
        }
    } catch (error) {
        console.error('Error in single result API:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint for all results
app.post('/api/all', async (req, res) => {
    try {
        const { htno } = req.body;
        if (!htno) {
            return res.status(400).json({ error: 'Hall ticket number is required' });
        }
        
        const results = await getAllResults(htno);
        res.json(results);
    } catch (error) {
        console.error('Error in all results API:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Refresh exam codes endpoint
app.post('/api/refresh-codes', async (req, res) => {
    try {
        await fetchExamCodes();
        res.json({ message: 'Exam codes refreshed successfully', codes: examCodes });
    } catch (error) {
        console.error('Error refreshing exam codes:', error);
        res.status(500).json({ error: 'Failed to refresh exam codes' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Initialize and start server
async function startServer() {
    try {
        console.log('Initializing JNTUH Results Portal...');
        await initExamCodes();
        
        let totalCodes = 0;
        for (let semester in examCodes) {
            totalCodes += examCodes[semester].length;
        }
        
        app.listen(port, '0.0.0.0', () => {
            console.log(`\nJNTUH Results Portal started successfully!`);
            console.log(`Server running at: http://0.0.0.0:${port}`);
            console.log(`Loaded exam codes: ${totalCodes} codes across ${Object.keys(examCodes).length} semesters`);
            
            console.log('\nExam Codes Summary:');
            for (let semester in examCodes) {
                if (examCodes[semester].length > 0) {
                    console.log(`   ${semester}: ${examCodes[semester].length} codes - [${examCodes[semester].slice(0, 3).join(', ')}${examCodes[semester].length > 3 ? '...' : ''}]`);
                }
            }
        });
    } catch (error) {
        console.error('Failed to start server:', error.message);
        
        console.log('\nAttempting to start with fallback codes only...');
        examCodes = { ...FALLBACK_EXAM_CODES };
        
        app.listen(port, '0.0.0.0', () => {
            console.log(`\nJNTUH Results Portal started in fallback mode!`);
            console.log(`Server running at: http://0.0.0.0:${port}`);
            console.log(`Using fallback exam codes: ${Object.keys(examCodes).length} semesters`);
        });
    }
}

process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});

startServer();
