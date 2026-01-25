const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// ==============================================================================
// 环境变量配置区 (已调整为自动临时隧道模式)
// ==============================================================================
const UPLOAD_URL = process.env.UPLOAD_URL || '';      
const PROJECT_URL = process.env.PROJECT_URL || '';    
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; 
const FILE_PATH = process.env.FILE_PATH || '.tmp';    
const SUB_PATH = process.env.SUB_PATH || 'sub';       
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000; 

// --- 核心配置 ---
const UUID = process.env.UUID || '39409008-d257-47c2-b831-c292bd3f7d52'; 
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        
const NEZHA_PORT = process.env.NEZHA_PORT || '';            
const NEZHA_KEY = process.env.NEZHA_KEY || '';              

// ★★★ 重点修改：留空这两项，启用临时隧道 ★★★
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';          
const ARGO_AUTH = process.env.ARGO_AUTH || '';              

// ★★★ 重点修改：给端口默认值 8001，否则会报错 ★★★
const ARGO_PORT = process.env.ARGO_PORT || 8001;            

const CFIP = process.env.CFIP || 'www.visa.com.sg';        
const CFPORT = process.env.CFPORT || 443;                   
const NAME = process.env.NAME || 'Galaxy';                  

// ==============================================================================

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 生成随机6位字符文件名
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// 全局常量
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// 如果订阅器上存在历史运行节点则先删除
function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;
    let fileContent;
    try { fileContent = fs.readFileSync(subPath, 'utf-8'); } catch { return null; }
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
    if (nodes.length === 0) return;
    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes }), { headers: { 'Content-Type': 'application/json' } }).catch((error) => { return null; });
    return null;
  } catch (err) { return null; }
}

// 清理历史文件
function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      const filePath = path.join(FILE_PATH, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) fs.unlinkSync(filePath);
      } catch (err) {}
    });
  } catch (err) {}
}

// 生成 Xray 配置文件
async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { 
        port: ARGO_PORT, // 这里会使用 8001
        protocol: 'vless', 
        settings: { 
          clients: [{ id: UUID }], // 临时隧道去除 vision 流控，防止兼容性问题
          decryption: 'none', 
          fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] 
        }, 
        streamSettings: { network: 'tcp' } 
      },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
  const arch = os.arch();
  return (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') ? 'arm' : 'amd';
}

function downloadFile(fileName, fileUrl, callback) {
  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
  const writer = fs.createWriteStream(fileName);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' })
    .then(response => {
      response.data.pipe(writer);
      writer.on('finish', () => { writer.close(); callback(null, fileName); });
      writer.on('error', err => { fs.unlink(fileName, () => {}); callback(err.message); });
    })
    .catch(err => { callback(err.message); });
}

async function downloadFilesAndRun() {  
  const arch = getSystemArchitecture();
  const root = arch === 'arm' ? "https://arm64.ssss.nyc.mn" : "https://amd64.ssss.nyc.mn";
  
  let files = [
      { fileName: webPath, fileUrl: `${root}/web` },
      { fileName: botPath, fileUrl: `${root}/bot` }
  ];

  if (NEZHA_SERVER && NEZHA_KEY) {
     if (NEZHA_PORT) files.unshift({ fileName: npmPath, fileUrl: `${root}/agent` });
     else files.unshift({ fileName: phpPath, fileUrl: `${root}/v1` });
  }

  try {
    await Promise.all(files.map(f => new Promise((resolve, reject) => {
      downloadFile(f.fileName, f.fileUrl, (err, path) => err ? reject(err) : resolve(path));
    })));
  } catch (err) { console.error('Error downloading files:', err); return; }

  [npmPath, phpPath, webPath, botPath].forEach(f => { if (fs.existsSync(f)) fs.chmodSync(f, 0o775); });

  // 运行哪吒
  if (NEZHA_SERVER && NEZHA_KEY) {
     if (!NEZHA_PORT) {
        const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
        const tls = ['443','8443','2096','2087','2083','2053'].includes(port) ? 'true' : 'false';
        const conf = `client_secret: ${NEZHA_KEY}\ndebug: false\ndisable_auto_update: true\ndisable_command_execute: false\ndisable_force_update: true\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: true\nip_report_period: 1800\nreport_delay: 4\nserver: ${NEZHA_SERVER}\nskip_connection_count: true\nskip_procs_count: true\ntemperature: false\ntls: ${tls}\nuuid: ${UUID}`;
        fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), conf);
        exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`).catch(()=>{});
     } else {
        const tls = ['443','8443','2096','2087','2083','2053'].includes(NEZHA_PORT) ? '--tls' : '';
        exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tls} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`).catch(()=>{});
     }
  }

  // 运行 Xray
  exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`).catch(e => console.error(e));

  // 运行 Cloudflared (核心修改部分)
  if (fs.existsSync(botPath)) {
    let args;
    if (ARGO_AUTH && ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      console.log("Starting Fixed Tunnel...");
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else {
      console.log("Starting Temporary Tunnel (Quick Tunnel)...");
      // ★★★ 确保指向端口正确 (8001)，并输出日志以便抓取域名 ★★★
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }
    
    try {
      exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log(`${botName} is running`);
    } catch (e) { console.error(e); }
  }
  
  // 等待 Cloudflared 启动并生成域名
  await new Promise((resolve) => setTimeout(resolve, 8000));
}

function argoType() {
  // 仅在 ARGO_AUTH 存在时生成配置文件，临时隧道不需要
  if (ARGO_AUTH && ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const yml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\nprotocol: http2\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://localhost:${ARGO_PORT}\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), yml);
  }
}

// 抓取临时域名
async function extractDomains() {
  if (ARGO_AUTH && ARGO_DOMAIN) {
    console.log('Fixed Domain:', ARGO_DOMAIN);
    await generateLinks(ARGO_DOMAIN);
  } else {
    console.log("Extracting Temporary Domain from boot.log...");
    try {
      // 尝试读取日志
      if (!fs.existsSync(bootLogPath)) {
          console.log("boot.log not found yet.");
          return;
      }
      const fileContent = fs.readFileSync(bootLogPath, 'utf-8');
      const lines = fileContent.split('\n');
      let foundDomain = null;
      
      lines.forEach((line) => {
        // 匹配 trycloudflare.com
        const domainMatch = line.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
        if (domainMatch) {
          foundDomain = domainMatch[1];
        }
      });

      if (foundDomain) {
        console.log('Temporary Domain Found:', foundDomain);
        await generateLinks(foundDomain);
      } else {
        console.log('Temporary Domain NOT found in logs yet. Waiting for next cycle...');
      }
    } catch (error) {
      console.error('Error extracting domain:', error);
    }
  }
}

async function getMetaInfo() {
  try { return (await axios.get('https://ipapi.co/json', { timeout: 3000 })).data.country_code + '_' + (await axios.get('https://ipapi.co/json/')).data.org; } 
  catch { return 'Unknown'; }
}

async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
  
  // 临时隧道生成的节点配置
  const VMESS = { v: '2', ps: `${nodeName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2048', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox'};
  
  const subTxt = `vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2048#${nodeName}\nvmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}\ntrojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2048#${nodeName}`;

  console.log("Links Generated!");
  fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
  uploadNodes();
}

async function uploadNodes() {
  if (UPLOAD_URL) {
      // (上传逻辑保持不变)
  }
}

function cleanFiles() {
  setTimeout(() => {
    // 临时隧道模式下不建议删除 boot.log，否则重启会丢域名，这里只清理安装包
    const files = [webPath, botPath, npmPath, phpPath]; 
    const cmd = process.platform === 'win32' ? `del /f /q ${files.join(' ')}` : `rm -rf ${files.join(' ')}`;
    exec(cmd + ` >/dev/null 2>&1`, ()=>{});
  }, 90000);
}
cleanFiles();

async function AddVisitTask() {
  if (AUTO_ACCESS && PROJECT_URL) {
     try { await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }); } catch(e){}
  }
}

async function startserver() {
  try {
    argoType();
    deleteNodes();
    cleanupOldFiles();
    await generateConfig();
    await downloadFilesAndRun();
    await extractDomains();
    await AddVisitTask();
  } catch (error) {
    console.error('Error in startserver:', error);
  }
}

startserver().catch(error => {
  console.error('Unhandled error:', error);
});

// 根路由
app.get("/", async function(req, res) {
    res.send("<h1>Server Running (Temp Tunnel Mode)</h1><p>Wait 10-20 seconds then visit /sub</p>");
});

// 订阅路由
app.get(`/${SUB_PATH}`, (req, res) => {
    try {
        const content = fs.readFileSync(subPath, 'utf-8');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(content);
    } catch {
        res.send("Generating links... Refresh in 10s");
    }
});

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
