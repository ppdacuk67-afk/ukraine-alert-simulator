const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mp3':'audio/mpeg', '.json':'application/json; charset=utf-8'
};
let boundaryCache = null;
const searchCache = new Map();
let lastNominatimRequestAt = 0;

async function politeDelay(){
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastNominatimRequestAt));
  if(wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatimRequestAt = Date.now();
}

function send(res,status,body,type='text/plain; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
}

async function searchUkraine(req,res){
  try{
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const q = (urlObj.searchParams.get('q') || '').trim();
    if(q.length < 2) return send(res,200,'[]','application/json; charset=utf-8');
    const cacheKey = q.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if(cached && (Date.now() - cached.time) < 24*60*60*1000){
      return send(res,200,JSON.stringify(cached.data),'application/json; charset=utf-8');
    }

    await politeDelay();
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format','jsonv2');
    u.searchParams.set('q', `${q}, Україна`);
    u.searchParams.set('countrycodes','ua');
    u.searchParams.set('addressdetails','1');
    u.searchParams.set('namedetails','1');
    u.searchParams.set('limit','12');
    u.searchParams.set('accept-language','uk');
    const r = await fetch(u,{headers:{'User-Agent':'UkraineAlertSimulator/2.1 (+public demo; OpenStreetMap search)','Accept-Language':'uk'}});
    const data = await r.json();
    const useful = data.filter(x => {
      const t = (x.type||'').toLowerCase();
      const cls = (x.class||'').toLowerCase();
      return cls === 'place' || cls === 'boundary' || ['city','town','village','municipality','administrative','district','borough','suburb'].includes(t);
    }).slice(0,10);
    searchCache.set(cacheKey,{time:Date.now(),data:useful});
    send(res,200,JSON.stringify(useful),'application/json; charset=utf-8');
  }catch(e){
    send(res,502,JSON.stringify({error:'Пошук OpenStreetMap тимчасово недоступний'}),'application/json; charset=utf-8');
  }
}

async function ukraineBoundary(res){
  try{
    if(boundaryCache) return send(res,200,JSON.stringify(boundaryCache),'application/json; charset=utf-8');
    await politeDelay();
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('format','jsonv2');
    u.searchParams.set('q','Україна');
    u.searchParams.set('countrycodes','ua');
    u.searchParams.set('polygon_geojson','1');
    u.searchParams.set('limit','1');
    u.searchParams.set('accept-language','uk');
    const r = await fetch(u,{headers:{'User-Agent':'UkraineAlertSimulator/2.1 (+public demo; OpenStreetMap search)','Accept-Language':'uk'}});
    const d = await r.json();
    boundaryCache = d?.[0]?.geojson || null;
    send(res,200,JSON.stringify(boundaryCache),'application/json; charset=utf-8');
  }catch(e){ send(res,502,'null','application/json; charset=utf-8'); }
}

function staticFile(req,res){
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if(pathname === '/') pathname='/index.html';
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(__dirname,safe);
  if(!file.startsWith(__dirname)) return send(res,403,'Forbidden');
  fs.readFile(file,(err,data)=>{
    if(err) return send(res,404,'404');
    send(res,200,data,MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

http.createServer((req,res)=>{
  if(req.url.startsWith('/api/search')) return searchUkraine(req,res);
  if(req.url.startsWith('/api/ukraine-boundary')) return ukraineBoundary(res);
  staticFile(req,res);
}).listen(PORT,'0.0.0.0',()=>console.log(`Сайт запущено на порту ${PORT}`));
