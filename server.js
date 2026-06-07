const express = require('express');
const axios = require('axios');
const JSSoup = require('jssoup').default;
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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

let examCodes = {};

const JNTUH_URLS = {
    HOME_IP: 'http://202.63.105.184/results/jsp/home.jsp',
    RESULT_IP: 'http://202.63.105.184/results/resultAction',
    HOME_DOMAIN: 'http://results.jntuh.ac.in/jsp/home.jsp',
    RESULT_DOMAIN: 'http://results.jntuh.ac.in/resultAction'
};

const COMPREHENSIVE_EXAM_CODES = {
    "1-1": ["1323","1358","1404","1430","1467","1504","1540","1572","1597","1615","1632","1647","1658","1660","1662","1675","1690","1699","1700","1732","1763","1764","1803","1804","1851","1852","1935","1936","1958","1959"],
    "1-2": ["1356","1363","1381","1435","1448","1481","1503","1525","1570","1590","1620","1622","1640","1655","1656","1670","1685","1704","1705","1730","1768","1769","1800","1801","1855","1856","1932","1933","1955","1956"],
    "2-1": ["1391","1425","1449","1496","1520","1560","1585","1610","1628","1645","1665","1667","1671","1680","1707","1728","1771","1772","1818","1819","1833","1834","1917","1918","1953","1954"],
    "2-2": ["1437","1447","1476","1501","1530","1565","1595","1605","1627","1650","1663","1675","1695","1711","1715","1725","1776","1813","1814","1837","1838","1913","1914","1951","1952"],
    "3-1": ["1454","1491","1535","1550","1575","1590","1626","1639","1645","1655","1670","1686","1688","1690","1697","1722","1784","1789","1828","1841","1842","1845","1846","1927","1928","1942","1943","1944","1967","1968"],
    "3-2": ["1502","1545","1555","1580","1595","1625","1638","1649","1654","1668","1682","1685","1690","1696","1698","1719","1780","1788","1823","1827","1847","1850","1921","1922","1925","1945","1946","1947","1964","1965","1966"],
    "4-1": ["1545","1585","1600","1624","1640","1644","1653","1670","1678","1682","1692","1695","1717","1758","1762","1795","1858","1861","1866","1869","1948","1949","1950"],
    "4-2": ["1580","1600","1615","1623","1635","1648","1658","1672","1673","1675","1677","1688","1691","1695","1698","1716","1790","1794","1808","1812","1862","1865","1939","1961","1962","1963"]
};

const GRADE_POINTS = { 'O': 10, 'A+': 9, 'A': 8, 'B+': 7, 'B': 6, 'C': 5, 'D': 4, 'F': 0, 'Ab': 0, '-': 0 };

function ensureDataDir() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
}

async function initExamCodes() {
    const dataDir = ensureDataDir();
    const codesFile = path.join(dataDir, 'codes.json');
    try {
        if (fs.existsSync(codesFile)) {
            const cachedData = JSON.parse(fs.readFileSync(codesFile, 'utf8'));
            const cacheDate = new Date(cachedData.date);
            const hoursSinceCache = (new Date() - cacheDate) / (1000 * 60 * 60);
            if (hoursSinceCache < 6) {
                examCodes = cachedData.codes;
                console.log('Loaded from cache');
                return;
            }
        }
    } catch (e) {}
    
    examCodes = JSON.parse(JSON.stringify(COMPREHENSIVE_EXAM_CODES));
    saveCodesToCache(examCodes);
}

function saveCodesToCache(codes) {
    try {
        const dataDir = ensureDataDir();
        fs.writeFileSync(path.join(dataDir, 'codes.json'), JSON.stringify({ date: new Date().toISOString(), codes }));
    } catch (e) {}
}

function parseSubjects(response) {
    try {
        const data = response.data || '';
        if (data.length < 1500) return null;
        if (data.includes('No Student Record Found') || data.includes('Invalid') || data.includes('Enter HallTicket Number')) return null;
        
        const soup = new JSSoup(data);
        const tables = soup.findAll("table");
        if (!tables || tables.length < 2) return null;
        
        const subjects = [];
        const trs = tables[1].findAll("tr");
        if (!trs || trs.length < 2) return null;
        
        const headerCells = trs[0].findAll("td") || trs[0].findAll("th");
        let colMap = { subjectCode: 0, subjectName: 1, internal: 2, external: 3, total: 4, grade: 5, credits: 6 };
        
        headerCells.forEach((cell, i) => {
            const t = cell.text.trim().toUpperCase();
            if (t.includes('SUBJECT CODE')) colMap.subjectCode = i;
            if (t.includes('SUBJECT NAME')) colMap.subjectName = i;
            if (t.includes('INTERNAL')) colMap.internal = i;
            if (t.includes('EXTERNAL')) colMap.external = i;
            if (t.includes('TOTAL')) colMap.total = i;
            if (t.includes('GRADE')) colMap.grade = i;
            if (t.includes('CREDIT')) colMap.credits = i;
        });
        
        for (let i = 1; i < trs.length; i++) {
            const tds = trs[i].findAll("td");
            if (!tds || tds.length < 7) continue;
            const code = (tds[colMap.subjectCode]?.text || '').trim();
            const name = (tds[colMap.subjectName]?.text || '').trim();
            if (code && name) {
                subjects.push(new Subject(code, name,
                    (tds[colMap.internal]?.text || '0').trim(),
                    (tds[colMap.external]?.text || '0').trim(),
                    (tds[colMap.total]?.text || '0').trim(),
                    (tds[colMap.grade]?.text || 'F').trim(),
                    (tds[colMap.credits]?.text || '0').trim()
                ));
            }
        }
        
        if (subjects.length === 0) return null;
        
        const infoTds = tables[0].findAll("tr")[0].findAll("td");
        const fatherTds = tables[0].findAll("tr").length > 1 ? tables[0].findAll("tr")[1].findAll("td") : [];
        
        const url = response.config?.url || '';
        const examCode = url.match(/examCode=(\d{4})/)?.[1] ? parseInt(url.match(/examCode=(\d{4})/)[1]) : null;
        
        return {
            name: (infoTds[3]?.text || '').trim(),
            htno: (infoTds[1]?.text || '').trim(),
            fatherName: fatherTds.length > 1 ? (fatherTds[1]?.text || '').trim() : '',
            collegeCode: fatherTds.length > 3 ? (fatherTds[3]?.text || '').trim() : '',
            subjects: subjects,
            examCode: examCode
        };
    } catch (e) {
        return null;
    }
}

function calculateCGPA(subjects) {
    let totalPoints = 0, totalCredits = 0;
    for (let s of subjects) {
        const grade = s.grade.toUpperCase();
        const credits = parseFloat(s.credits) || 0;
        if (GRADE_POINTS[grade] !== undefined && credits > 0 && grade !== 'F' && grade !== 'Ab' && grade !== '-') {
            totalPoints += GRADE_POINTS[grade] * credits;
            totalCredits += credits;
        }
    }
    return totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0;
}

function isPassed(grade) {
    const g = grade.toUpperCase();
    return g !== 'F' && g !== 'Ab' && g !== '-';
}

// CORE FIX: Remove failed subjects that were later passed
function cleanResults(allResults) {
    if (!allResults || allResults.length === 0) return allResults;
    
    // Sort by exam code (chronological order)
    const sorted = [...allResults].sort((a, b) => a.examCode - b.examCode);
    
    // Track best result for each subject
    const subjectBest = new Map(); // key: subjectCode, value: { grade, examCode, subject }
    
    for (let result of sorted) {
        for (let subject of result.subjects) {
            const code = subject.subjectCode;
            const grade = subject.grade.toUpperCase();
            const current = subjectBest.get(code);
            
            if (!current) {
                subjectBest.set(code, { grade, examCode: result.examCode, subject });
            } else if (isPassed(grade) && !isPassed(current.grade)) {
                // Current passed but previous was failed
                subjectBest.set(code, { grade, examCode: result.examCode, subject });
            } else if (isPassed(grade) && isPassed(current.grade)) {
                // Both passed, keep the better grade
                const currentPoints = GRADE_POINTS[current.grade] || 0;
                const newPoints = GRADE_POINTS[grade] || 0;
                if (newPoints > currentPoints) {
                    subjectBest.set(code, { grade, examCode: result.examCode, subject });
                }
            }
        }
    }
    
    // Now clean each result - remove failed subjects that were later passed
    const cleanedResults = sorted.map(result => {
        const cleanedSubjects = result.subjects.filter(subject => {
            const code = subject.subjectCode;
            const best = subjectBest.get(code);
            if (!best) return true;
            
            // If this result has a failed grade but student passed later, remove it
            if (!isPassed(subject.grade) && isPassed(best.grade) && best.examCode > result.examCode) {
                return false;
            }
            
            // If this is not the best attempt for this subject, remove it
            if (best.examCode > result.examCode && best.subject.subjectCode === code) {
                return false;
            }
            
            return true;
        });
        
        return { ...result, subjects: cleanedSubjects };
    }).filter(result => result.subjects.length > 0);
    
    return cleanedResults;
}

// Calculate overall CGPA across all semesters
function calculateOverallCGPA(allResults) {
    const allSubjects = [];
    const seenCodes = new Map();
    
    for (let result of allResults) {
        for (let subject of result.subjects) {
            const code = subject.subjectCode;
            const grade = subject.grade.toUpperCase();
            const current = seenCodes.get(code);
            
            if (!current) {
                seenCodes.set(code, subject);
            } else if (isPassed(grade) && !isPassed(current.grade)) {
                seenCodes.set(code, subject);
            } else if (isPassed(grade) && isPassed(current.grade)) {
                if ((GRADE_POINTS[grade] || 0) > (GRADE_POINTS[current.grade] || 0)) {
                    seenCodes.set(code, subject);
                }
            }
        }
    }
    
    let totalPoints = 0, totalCredits = 0;
    for (let subject of seenCodes.values()) {
        const grade = subject.grade.toUpperCase();
        const credits = parseFloat(subject.credits) || 0;
        if (GRADE_POINTS[grade] !== undefined && credits > 0 && isPassed(grade)) {
            totalPoints += GRADE_POINTS[grade] * credits;
            totalCredits += credits;
        }
    }
    
    return totalCredits > 0 ? parseFloat((totalPoints / totalCredits).toFixed(2)) : 0;
}

// Find remaining backlogs
function findBacklogs(allResults) {
    const subjectBest = new Map();
    
    for (let result of allResults) {
        for (let subject of result.subjects) {
            const code = subject.subjectCode;
            const grade = subject.grade.toUpperCase();
            const current = subjectBest.get(code);
            
            if (!current) {
                subjectBest.set(code, { grade, subject, examCode: result.examCode });
            } else if (isPassed(grade) && !isPassed(current.grade)) {
                subjectBest.set(code, { grade, subject, examCode: result.examCode });
            }
        }
    }
    
    const backlogs = [];
    for (let [code, data] of subjectBest) {
        if (!isPassed(data.grade)) {
            backlogs.push(data.subject);
        }
    }
    
    return backlogs;
}

async function getAllResults(htno) {
    const config = {
        headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0"
        },
        timeout: 10000
    };
    
    const isLateralEntry = htno.length >= 5 && htno[4] === '5';
    const promises = [];
    
    for (let semester in examCodes) {
        if (isLateralEntry && (semester === "1-1" || semester === "1-2")) continue;
        
        const codes = examCodes[semester];
        for (let code of codes) {
            promises.push({
                semester, code,
                promise: axios.get(`${JNTUH_URLS.RESULT_IP}?degree=btech&examCode=${code}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`, config)
                    .catch(() => axios.get(`${JNTUH_URLS.RESULT_DOMAIN}?degree=btech&examCode=${code}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`, config))
                    .catch(() => null)
            });
        }
    }
    
    console.log(`Fetching ${promises.length} requests for ${htno}`);
    
    const batchSize = 10;
    const results = [];
    
    for (let i = 0; i < promises.length; i += batchSize) {
        const batch = promises.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (item) => {
            const response = await item.promise;
            return { ...item, response };
        }));
        results.push(...batchResults);
        if (i + batchSize < promises.length) await new Promise(r => setTimeout(r, 200));
    }
    
    const validResults = results.filter(item => {
        if (!item.response?.data || item.response.data.length < 1500) return false;
        if (item.response.data.includes('No Student Record Found') ||
            item.response.data.includes('Invalid') ||
            item.response.data.includes('Enter HallTicket Number')) return false;
        return true;
    });
    
    const parsedMap = new Map();
    for (let item of validResults) {
        const parsed = parseSubjects(item.response);
        if (parsed && parsed.examCode) {
            const key = item.semester;
            // Keep the latest result for each semester
            if (!parsedMap.has(key) || parsed.examCode > parsedMap.get(key).examCode) {
                parsedMap.set(key, parsed);
            }
        }
    }
    
    let finalResults = Array.from(parsedMap.values());
    finalResults.sort((a, b) => a.examCode - b.examCode);
    
    // Clean results - remove failed subjects that were passed later
    finalResults = cleanResults(finalResults);
    
    // Calculate overall stats
    const overallCGPA = calculateOverallCGPA(finalResults);
    const backlogs = findBacklogs(finalResults);
    const allClear = backlogs.length === 0;
    
    // Calculate semester-wise CGPA
    finalResults = finalResults.map(result => ({
        ...result,
        semesterCGPA: calculateCGPA(result.subjects)
    }));
    
    console.log(`Found ${finalResults.length} semesters, CGPA: ${overallCGPA}, Backlogs: ${backlogs.length}`);
    
    if (finalResults.length === 0) {
        throw new Error('No results found');
    }
    
    return {
        studentInfo: {
            name: finalResults[0]?.name || 'Unknown',
            htno: htno,
            fatherName: finalResults[0]?.fatherName || '',
            collegeCode: finalResults[0]?.collegeCode || ''
        },
        semesters: finalResults,
        overallCGPA: overallCGPA,
        totalSemesters: finalResults.length,
        backlogs: backlogs,
        backlogsCount: backlogs.length,
        allClear: allClear,
        message: allClear ? 'All subjects cleared successfully' : `${backlogs.length} subject(s) pending`
    };
}

// Routes
app.get('/', (req, res) => {
    let totalCodes = 0;
    for (let s in examCodes) totalCodes += examCodes[s].length;
    res.json({
        status: 'online',
        service: 'JNTUH Results API',
        version: '3.0.0',
        totalCodes,
        semesters: Object.keys(examCodes).length
    });
});

app.get('/api/codes', (req, res) => {
    let total = 0;
    for (let s in examCodes) total += examCodes[s].length;
    res.json({ total, semesters: examCodes });
});

app.post('/api/single', async (req, res) => {
    try {
        const { htno, examCode } = req.body;
        if (!htno) return res.status(400).json({ error: 'Hall ticket number required' });
        
        const codes = examCode ? [examCode] : examCodes["4-2"];
        const config = {
            headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "User-Agent": "Mozilla/5.0" },
            timeout: 10000
        };
        
        for (let code of codes) {
            try {
                const url = `${JNTUH_URLS.RESULT_IP}?degree=btech&examCode=${code}&etype=r17&result=null&grad=null&type=intgrade&htno=${htno}`;
                const response = await axios.get(url, config);
                const result = parseSubjects(response);
                if (result) {
                    result.semesterCGPA = calculateCGPA(result.subjects);
                    return res.json(result);
                }
            } catch (e) {
                continue;
            }
        }
        
        res.status(404).json({ error: 'No results found' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/all', async (req, res) => {
    try {
        const { htno } = req.body;
        if (!htno) return res.status(400).json({ error: 'Hall ticket number required' });
        
        const results = await getAllResults(htno);
        res.json(results);
    } catch (e) {
        res.status(404).json({ error: e.message || 'No results found' });
    }
});

app.post('/api/refresh-codes', async (req, res) => {
    res.json({ message: 'Using comprehensive codes', total: Object.keys(examCodes).reduce((sum, s) => sum + examCodes[s].length, 0) });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: 'Server error' }));

async function startServer() {
    await initExamCodes();
    let totalCodes = 0;
    for (let s in examCodes) totalCodes += examCodes[s].length;
    
    app.listen(port, '0.0.0.0', () => {
        console.log(`Server v3.0 running on port ${port}`);
        console.log(`${totalCodes} codes, ${Object.keys(examCodes).length} semesters`);
    });
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

startServer();
