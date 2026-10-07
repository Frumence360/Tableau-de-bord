const $=s=>document.querySelector(s), page=$('#page');
let saved=null, dl=null;
const entryMode=new URLSearchParams(location.search).get('mode')==='entry';
const insertEntry=$('#insertEntry');
if(entryMode)insertEntry.hidden=false;
// Icônes d'alignement
const al={justifyLeft:[[3,5,13,5],[3,9,10,9],[3,13,13,13]],justifyCenter:[[3,5,13,5],[5,9,11,9],[3,13,13,13]],justifyRight:[[3,5,13,5],[6,9,13,9],[3,13,13,13]],justifyFull:[[3,5,13,5],[3,9,13,9],[3,13,13,13]]};
const names={justifyLeft:'Aligner à gauche',justifyCenter:'Centrer',justifyRight:'Aligner à droite',justifyFull:'Justifier'};
$('#aligns').innerHTML=Object.keys(al).map(k=>`<button data-c="${k}" title="${names[k]}"><svg class="i" viewBox="0 0 16 18">${al[k].map(l=>`<line x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}"/>`).join('')}</svg></button>`).join('');
$('#size').innerHTML=[8,9,10,11,12,14,16,18,20,24,28,36,48,72].map(n=>`<option${n==11?' selected':''}>${n}</option>`).join('');

document.execCommand('styleWithCSS',false,true);
document.execCommand('defaultParagraphSeparator',false,'p');

// Sélection mémorisée pour les menus et sélecteurs de couleur
document.addEventListener('selectionchange',()=>{
  const s=getSelection();
  if(s.rangeCount&&page.contains(s.anchorNode)){saved=s.getRangeAt(0).cloneRange();refresh();}
});
function restore(){page.focus();if(saved){const s=getSelection();s.removeAllRanges();s.addRange(saved);}}
function run(c,v){restore();document.execCommand(c,false,v==null?null:v);changed();}
$('#ribbon').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
$('#ribbon').addEventListener('click',e=>{const b=e.target.closest('button[data-c]');if(b)run(b.dataset.c);});

$('#style').onchange=e=>{run('formatBlock',e.target.value==='p'?'<p>':'<'+e.target.value+'>');};
$('#font').onchange=e=>run('fontName',e.target.value);
$('#size').onchange=e=>{
  restore();document.execCommand('fontSize',false,'7');
  page.querySelectorAll('font[size="7"],span[style*="xxx-large"]').forEach(f=>{
    const s=document.createElement('span');s.style.cssText=f.getAttribute('style')||'';
    s.style.fontSize=e.target.value+'pt';s.innerHTML=f.innerHTML;f.replaceWith(s);
  });changed();
};
$('#lh').onchange=e=>{
  restore();const s=getSelection();if(!s.rangeCount)return;
  page.querySelectorAll('p,h1,h2,h3,li,blockquote,div').forEach(el=>{if(s.containsNode(el,true))el.style.lineHeight=e.target.value;});
  changed();
};
$('#fc').oninput=e=>{$('#fcsw').style.background=e.target.value;run('foreColor',e.target.value);};
$('#hc').oninput=e=>{$('#hcsw').style.background=e.target.value;run('hiliteColor',e.target.value);};

// Tableau, image, lien
$('#tbl').onclick=()=>{const r='<tr><td><br></td><td><br></td><td><br></td></tr>';run('insertHTML','<table><tbody>'+r+r+r+'</tbody></table><p><br></p>');};
$('#imgBtn').onclick=()=>$('#img').click();
$('#img').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>run('insertImage',r.result);r.readAsDataURL(f);e.target.value='';};
$('#lnk').onclick=()=>{$('#linkbar').classList.toggle('open');if($('#linkbar').classList.contains('open'))$('#url').focus();};
const closeLink=()=>{$('#linkbar').classList.remove('open');$('#url').value='';};
$('#okLink').onclick=()=>{let u=$('#url').value.trim();if(u){if(!/^(https?:|mailto:)/i.test(u))u='https://'+u;run('createLink',u);}closeLink();};
$('#url').onkeydown=e=>{if(e.key==='Enter')$('#okLink').click();if(e.key==='Escape')closeLink();};
$('#noLink').onclick=closeLink;

// État des boutons
const states=['bold','italic','underline','strikeThrough','subscript','superscript','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight','justifyFull'];
function refresh(){
  states.forEach(c=>{const b=document.querySelector(`button[data-c="${c}"]`);if(b){let on=false;try{on=document.queryCommandState(c);}catch(e){}b.classList.toggle('on',on);}});
  try{const f=document.queryCommandValue('fontName').replace(/["']/g,'').split(',')[0].trim();const o=[...$('#font').options].find(o=>o.value===f);if(o)$('#font').value=f;}catch(e){}
}

// Compteurs, sauvegarde automatique
let t;
function changed(){
  const x=page.innerText.trim();const w=x?x.split(/\s+/).length:0;
  $('#words').textContent=w+(w>1?' mots':' mot');$('#chars').textContent=x.length+(x.length>1?' caractères':' caractère');
  schedLayout();clearTimeout(t);t=setTimeout(()=>{try{localStorage.setItem('redacteur:doc',JSON.stringify({n:$('#title').value,h:cleanHTML()}));$('#saved').textContent='Enregistré dans le navigateur';}catch(e){}},600);
}
page.addEventListener('input',changed);$('#title').addEventListener('input',changed);
try{const d=JSON.parse(localStorage.getItem('redacteur:doc')||'null');if(d&&d.h){page.innerHTML=d.h;$('#title').value=d.n||'Document1';}}catch(e){}
changed();

// Zoom
$('#zoom').oninput=e=>{const z=e.target.value/100;$('#sheet').style.zoom=z;$('#zv').textContent=e.target.value+' %';};

// Nouveau (double clic de confirmation)
let ct;$('#new').onclick=function(){
  if(!page.innerText.trim()||this.dataset.ask){page.innerHTML='<p><br></p>';$('#title').value='Document1';this.textContent='Nouveau';delete this.dataset.ask;changed();page.focus();return;}
  this.dataset.ask=1;this.textContent='Effacer ? Cliquez encore';clearTimeout(ct);ct=setTimeout(()=>{this.textContent='Nouveau';delete this.dataset.ask;},3000);
};

// Ouvrir
$('#open').onclick=()=>$('#file').click();
$('#file').onchange=e=>{
  const f=e.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=()=>{
    const name=f.name.replace(/\.[^.]+$/,'');let html;
    if(/\.html?$/i.test(f.name)){
      const d=new DOMParser().parseFromString(r.result,'text/html');
      d.querySelectorAll('script,iframe,object,embed,style').forEach(n=>n.remove());
      d.body.querySelectorAll('*').forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||/^javascript:/i.test(a.value))n.removeAttribute(a.name);}));
      html=d.body.innerHTML;
    }else{
      html=r.result.split(/\n{2,}/).map(p=>'<p>'+p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')+'</p>').join('');
    }
    page.innerHTML=html||'<p><br></p>';$('#title').value=name;changed();
  };
  r.readAsText(f);e.target.value='';
};

// Export (capacité de téléchargement du viewer, ou lien classique hors d'Artifacts)
const fname=ext=>(($('#title').value.trim()||'document').replace(/[\\/:*?"<>|]/g,'-'))+'.'+ext;
async function save(ext,data){
  try{
    if(dl){await dl.save({filename:fname(ext),data});}
    else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data]));a.download=fname(ext);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  }catch(e){if(e&&/rejected_extension|extension_not_enabled/.test(e.code))$('#saved').textContent='Format indisponible ici';else if(!e||e.code!=='declined')console.error(e);}
}
$('#saveHtml').onclick=()=>save('html','<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>'+$('#title').value.replace(/</g,'&lt;')+'</title><style>body{font:11pt/1.5 Calibri,Arial,sans-serif;max-width:794px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;width:100%}td{border:1px solid #8a8a8a;padding:6px 8px}img{max-width:100%}</style></head><body>'+cleanHTML()+'</body></html>');
$('#saveTxt').onclick=()=>save('txt',page.innerText);
$('#print').onclick=()=>{try{window.print();}catch(e){}};

// ---- Rechercher / remplacer
let pos=0,lastStart=0;const fb=$('#findbar');
function openFind(){const t=getSelection().toString();if(t&&t.length<80&&!/\n/.test(t))$('#fq').value=t;fb.classList.add('open');$('#fq').focus();$('#fq').select();}
function textMap(){const w=document.createTreeWalker(page,NodeFilter.SHOW_TEXT),a=[];let s='',n;while(n=w.nextNode()){a.push([n,s.length]);s+=n.nodeValue;}return{a,s};}
const at=(a,i,end)=>{let r=a[0];for(const x of a){if(end?x[1]<i:x[1]<=i)r=x;else break;}return[r[0],i-r[1]];};
function findNext(from,nowrap){
  const q=$('#fq').value;if(!q)return false;const{a,s}=textMap();if(!a.length)return false;
  const L=s.toLowerCase(),Q=q.toLowerCase();let i=L.indexOf(Q,from==null?pos:from);
  if(i<0&&!nowrap)i=L.indexOf(Q,0);
  if(i<0){$('#fcount').textContent=nowrap?'':'Aucun résultat';return false;}
  const r=document.createRange(),st=at(a,i),en=at(a,i+Q.length,true);r.setStart(st[0],st[1]);r.setEnd(en[0],en[1]);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(r);saved=r.cloneRange();
  lastStart=i;pos=i+Q.length;
  if(!nowrap){r.startContainer.parentElement.scrollIntoView({block:'center'});$('#fcount').textContent='';}
  return true;
}
$('#fbtn').onclick=openFind;$('#fx').onclick=()=>fb.classList.remove('open');
$('#fn').onclick=()=>findNext();
$('#fq').oninput=()=>{pos=0;$('#fcount').textContent='';};
$('#fq').onkeydown=e=>{if(e.key==='Enter')findNext();if(e.key==='Escape')fb.classList.remove('open');};
$('#frp').onclick=()=>{
  const q=$('#fq').value.toLowerCase(),s=getSelection();
  if(q&&s.rangeCount&&page.contains(s.anchorNode)&&s.toString().toLowerCase()===q){
    page.focus();document.execCommand('insertText',false,$('#fr').value);pos=lastStart+$('#fr').value.length;changed();
  }
  findNext();
};
$('#fa').onclick=()=>{
  const rep=$('#fr').value;let n=0;pos=0;page.focus();
  while(n<5000&&findNext(pos,true)){document.execCommand('insertText',false,rep);pos=lastStart+rep.length;n++;}
  $('#fcount').textContent=n+(n>1?' remplacements':' remplacement');changed();
};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&/^[fh]$/i.test(e.key)){e.preventDefault();openFind();}});

// ---- Export .docx (zip + WordprocessingML écrits à la main)
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return(~c)>>>0;};
function zip(files){
  const e=new TextEncoder(),L=[],C=[];let o=0;
  for(const[n,s]of files){
    const nb=e.encode(n),d=typeof s==='string'?e.encode(s):s,c=crc(d);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,c,true);h.setUint32(18,d.length,true);h.setUint32(22,d.length,true);h.setUint16(26,nb.length,true);
    L.push(new Uint8Array(h.buffer),nb,d);
    const g=new DataView(new ArrayBuffer(46));g.setUint32(0,0x02014b50,true);g.setUint16(4,20,true);g.setUint16(6,20,true);g.setUint16(8,0x0800,true);g.setUint32(16,c,true);g.setUint32(20,d.length,true);g.setUint32(24,d.length,true);g.setUint16(28,nb.length,true);g.setUint32(42,o,true);
    C.push(new Uint8Array(g.buffer),nb);o+=30+nb.length+d.length;
  }
  const cs=C.reduce((a,x)=>a+x.length,0),z=new DataView(new ArrayBuffer(22));
  z.setUint32(0,0x06054b50,true);z.setUint16(8,files.length,true);z.setUint16(10,files.length,true);z.setUint32(12,cs,true);z.setUint32(16,o,true);
  return new Blob([...L,...C,new Uint8Array(z.buffer)]);
}
const WNS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',XH='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wx=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const whex=c=>{if(!c||(/^rgba/.test(c)&&/,\s*0\)$/.test(c)))return null;const m=c.match(/\d+/g);return m&&m.length>=3?m.slice(0,3).map(v=>(+v).toString(16).padStart(2,'0')).join('').toUpperCase():null;};
function wsf(n,f){
  f={...f};const t=n.tagName,s=n.style||{};
  if(t==='B'||t==='STRONG')f.b=1;if(t==='I'||t==='EM')f.i=1;if(t==='U')f.u=1;if(t==='S'||t==='STRIKE'||t==='DEL')f.s=1;
  if(t==='SUB')f.va='subscript';if(t==='SUP')f.va='superscript';
  if(s.fontWeight==='bold'||+s.fontWeight>=600)f.b=1;if(s.fontStyle==='italic')f.i=1;
  const td=(s.textDecoration||'')+(s.textDecorationLine||'');if(/underline/.test(td))f.u=1;if(/line-through/.test(td))f.s=1;
  const c=whex(s.color);if(c)f.c=c;const bg=whex(s.backgroundColor);if(bg)f.bg=bg;
  const z=(s.fontSize||'').match(/([\d.]+)pt/);if(z)f.sz=Math.round(z[1]*2);
  if(s.fontFamily)f.ff=s.fontFamily.split(',')[0].replace(/["']/g,'').trim();
  return f;
}
function wr(t,f){
  let p='';
  if(f.ff)p+=`<w:rFonts w:ascii="${wx(f.ff)}" w:hAnsi="${wx(f.ff)}" w:cs="${wx(f.ff)}"/>`;
  if(f.b)p+='<w:b/>';if(f.i)p+='<w:i/>';if(f.s)p+='<w:strike/>';
  if(f.c)p+=`<w:color w:val="${f.c}"/>`;
  if(f.sz)p+=`<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>`;
  if(f.u)p+='<w:u w:val="single"/>';
  if(f.bg)p+=`<w:shd w:val="clear" w:color="auto" w:fill="${f.bg}"/>`;
  if(f.va)p+=`<w:vertAlign w:val="${f.va}"/>`;
  return `<w:r>${p?`<w:rPr>${p}</w:rPr>`:''}<w:t xml:space="preserve">${wx(t)}</w:t></w:r>`;
}
const BLK=/^(P|DIV|H[1-3]|BLOCKQUOTE|UL|OL|TABLE|HR)$/;
function wruns(n,f){
  if(n.nodeType===3)return n.nodeValue?wr(n.nodeValue,f):'';
  if(n.nodeType!==1)return'';
  if(n.tagName==='BR')return'<w:r><w:br/></w:r>';
  if(n.tagName==='IMG'){const m=IM.get(n);return m?wimg(m):'';}
  if(/^(TABLE|UL|OL|HR)$/.test(n.tagName))return'';
  f=wsf(n,f);return[...n.childNodes].map(c=>wruns(c,f)).join('');
}
function wp(inner,el,o={}){
  const s=(el&&el.style)||{};let p='';
  if(o.bdr)p+='<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="888888"/></w:pBdr>';
  const lh=parseFloat(s.lineHeight);
  p+=`<w:spacing w:after="${o.after==null?160:o.after}"${lh?` w:line="${Math.round(lh*240)}" w:lineRule="auto"`:''}/>`;
  if(o.ind)p+=`<w:ind w:left="${o.ind}"${o.hang?` w:hanging="${o.hang}"`:''}/>`;
  const j={center:'center',right:'right',justify:'both'}[s.textAlign];if(j)p+=`<w:jc w:val="${j}"/>`;
  return `<w:p><w:pPr>${p}</w:pPr>${inner}</w:p>`;
}
function wblocks(c,f,ind){
  let out='',buf='';
  const flush=()=>{if(buf)out+=wp(buf,c,{ind});buf='';};
  for(const n of c.childNodes){
    if(n.nodeType===1&&BLK.test(n.tagName)){flush();out+=wblock(n,f,ind);}else buf+=wruns(n,f);
  }
  flush();return out;
}
function wblock(n,f,ind){
  const t=n.tagName;f=wsf(n,f);
  if(t==='HR')return wp('',null,{bdr:1});
  if(t==='UL'||t==='OL'){
    let i=0,o='';
    for(const li of n.children){
      if(li.tagName!=='LI')continue;i++;
      const sub=[...li.children].filter(c=>/^(UL|OL)$/.test(c.tagName));
      const own=[...li.childNodes].filter(c=>!sub.includes(c)).map(c=>wruns(c,f)).join('');
      o+=wp(wr(t==='UL'?'• ':i+'. ',f)+own,li,{ind:ind+720,hang:360,after:60});
      sub.forEach(s=>{o+=wblock(s,f,ind+720);});
    }
    return o;
  }
  if(t==='TABLE'){
    const rows=[...n.querySelectorAll('tr')],cols=Math.max(1,...rows.map(r=>r.cells.length));
    const cg=[...n.querySelectorAll('col')].map(c=>Math.round((parseFloat(c.style.width)||0)*15));
    const ws=Array.from({length:cols},(_,i)=>cg.length===cols&&cg[i]>0?cg[i]:Math.floor(9000/cols));
    const b=['top','left','bottom','right','insideH','insideV'].map(x=>`<w:${x} w:val="single" w:sz="4" w:space="0" w:color="8A8A8A"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${ws.reduce((a,x)=>a+x,0)}" w:type="dxa"/><w:tblBorders>${b}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`+
      rows.map(r=>{const rh=parseFloat(r.style.height);return '<w:tr>'+(rh?`<w:trPr><w:trHeight w:val="${Math.round(rh*15)}" w:hRule="atLeast"/></w:trPr>`:'')+[...r.cells].map((td,i)=>`<w:tc><w:tcPr><w:tcW w:w="${ws[i]}" w:type="dxa"/></w:tcPr>${wblocks(td,f,0)||wp('',null)}</w:tc>`).join('')+'</w:tr>';}).join('')+'</w:tbl>'+wp('',null,{after:0});
  }
  if(/^H[1-3]$/.test(t)){const k={H1:[40,'185ABD'],H2:[30,'185ABD'],H3:[24,'1F3F73']}[t];f={...f,b:1,sz:k[0],c:k[1]};}
  const hasBlk=[...n.children].some(c=>BLK.test(c.tagName));
  if(t==='BLOCKQUOTE')ind+=480;
  if(hasBlk)return wblocks(n,f,ind);
  return wp([...n.childNodes].map(c=>wruns(c,f)).join(''),n,{ind,after:t[0]==='H'?120:160});
}
async function docx(){
  const im=await wimgs();
  const ct='application/vnd.openxmlformats-officedocument.wordprocessingml.';
  const body=wblocks(page,{},0);
  const pg='<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    ['[Content_Types].xml',XH+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="${ct}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${ct}styles+xml"/><Override PartName="/word/footer1.xml" ContentType="${ct}footer+xml"/></Types>`],
    ['_rels/.rels',XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels',XH+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${rel}/footer" Target="footer1.xml"/>${im.map(x=>`<Relationship Id="${x.rid}" Type="${rel}/image" Target="${x.file}"/>`).join('')}</Relationships>`],
    ['word/styles.xml',XH+`<w:styles ${WNS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`],
    ['word/footer1.xml',XH+`<w:ftr ${WNS}>${pg}</w:ftr>`],
    ['word/document.xml',XH+`<w:document ${WNS} xmlns:r="${rel}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`],...im.map(x=>[x.name,x.data])
  ]);
}
$('#saveDocx').onclick=async()=>{try{save('docx',await docx());}catch(e){$('#saved').textContent='Export Word impossible';console.error(e);}};
// ---- Images dans le .docx
var IM=new Map();
async function wimgs(){
  IM=new Map();const out=[];let k=0;
  for(const img of page.querySelectorAll('img')){
    const m=/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i.exec(img.src);let ext,b64;
    if(m){ext=m[1].toLowerCase().replace('jpeg','jpg');b64=m[2];}
    else{try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);b64=c.toDataURL('image/png').split(',')[1];ext='png';}catch(e){continue;}}
    const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
    k++;IM.set(img,{id:k,rid:'rId'+(10+k),cx:Math.round(img.offsetWidth*9525),cy:Math.round(img.offsetHeight*9525)});
    out.push({name:`word/media/image${k}.${ext}`,data:u,rid:'rId'+(10+k),file:`media/image${k}.${ext}`});
  }
  return out;
}
function wimg(m){
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${m.cx}" cy="${m.cy}"/><wp:docPr id="${m.id}" name="Image ${m.id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${m.id}" name="image${m.id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// ---- Découpage en pages A4 (blocs repoussés sur la page suivante)
var PH=1123,PGAP=24,STEP=1147,MB=96,PAGES=1,lt;
function schedLayout(){clearTimeout(lt);lt=setTimeout(layout,120);}
function cleanHTML(){
  const c=page.cloneNode(true);
  c.querySelectorAll('[data-pb]').forEach(e=>{e.style.marginTop='';e.removeAttribute('data-pb');if(!e.getAttribute('style'))e.removeAttribute('style');});
  return c.innerHTML;
}
function layout(){
  const sh=$('#sheet'),z=sh.style.zoom;sh.style.zoom='';
  const mt=parseFloat(getComputedStyle(page).paddingTop)||96,usable=PH-mt-MB;
  page.querySelectorAll('[data-pb]').forEach(e=>{e.style.marginTop='';e.removeAttribute('data-pb');if(!e.getAttribute('style'))e.removeAttribute('style');});
  const units=[...page.children].flatMap(c=>/^(UL|OL)$/.test(c.tagName)?[...c.children]:[c]);
  let last=mt;
  for(const u of units){
    const h=u.offsetHeight,top=u.offsetTop,k=Math.floor(top/STEP);
    if(top+h>k*STEP+PH-MB&&h<=usable&&top>k*STEP+mt+1){
      const target=(k+1)*STEP+mt,cur=parseFloat(getComputedStyle(u).marginTop)||0;
      u.style.marginTop=(cur+target-top)+'px';u.setAttribute('data-pb','1');
      const d=target-u.offsetTop;if(d)u.style.marginTop=(cur+target-top+d)+'px';
    }
    last=u.offsetTop+u.offsetHeight;
  }
  PAGES=Math.floor(Math.max(0,last-1)/STEP)+1;
  page.style.minHeight=(PAGES*STEP-PGAP)+'px';
  sh.style.zoom=z;
  $('#pgs').textContent=PAGES+(PAGES>1?' pages':' page');
}
window.addEventListener('resize',schedLayout);
page.addEventListener('load',schedLayout,true);

// ---- Redimensionnement des tableaux (bords des colonnes et des lignes)
var rz=null;
const zf=()=>+$('#zoom').value/100;
function edgeAt(e){
  const td=e.target.closest&&e.target.closest('td');if(!td)return'';
  const r=td.getBoundingClientRect();
  if(Math.abs(r.right-e.clientX)<=5)return'c';if(Math.abs(r.bottom-e.clientY)<=4)return'r';return'';
}
function prepCols(tb){
  let cg=tb.querySelector('colgroup');
  if(!cg){const ws=[...tb.rows[0].cells].map(c=>c.offsetWidth);cg=document.createElement('colgroup');cg.innerHTML=ws.map(w=>`<col style="width:${w}px">`).join('');tb.insertBefore(cg,tb.firstChild);tb.style.tableLayout='fixed';tb.style.width=ws.reduce((a,x)=>a+x,0)+'px';}
  return[...cg.children];
}
page.addEventListener('mousemove',e=>{if(!rz)page.style.cursor={c:'col-resize',r:'row-resize'}[edgeAt(e)]||'';});
page.addEventListener('mousedown',e=>{
  const d=edgeAt(e);if(!d)return;e.preventDefault();
  const td=e.target.closest('td'),tb=td.closest('table'),cols=prepCols(tb),i=td.cellIndex;
  rz={d,tb,cols,i,tr:td.parentElement,x:e.clientX,y:e.clientY,w:parseFloat(cols[i].style.width),w2:cols[i+1]?parseFloat(cols[i+1].style.width):0,h:td.parentElement.offsetHeight,tot:parseFloat(tb.style.width)};
});
document.addEventListener('mousemove',e=>{
  if(!rz)return;const z=zf(),dx=(e.clientX-rz.x)/z,dy=(e.clientY-rz.y)/z;
  if(rz.d==='r')rz.tr.style.height=Math.max(20,rz.h+dy)+'px';
  else if(rz.cols[rz.i+1]){const nw=Math.min(rz.w+rz.w2-40,Math.max(40,rz.w+dx));rz.cols[rz.i].style.width=nw+'px';rz.cols[rz.i+1].style.width=(rz.w+rz.w2-nw)+'px';}
  else{const cw=page.clientWidth-2*parseFloat(getComputedStyle(page).paddingLeft),nw=Math.max(40,Math.min(rz.w+dx,cw-(rz.tot-rz.w)));rz.cols[rz.i].style.width=nw+'px';rz.tb.style.width=(rz.tot-rz.w+nw)+'px';}
  schedLayout();
});
document.addEventListener('mouseup',()=>{if(rz){rz=null;changed();}});

// ---- Export PDF (chaque page est dessinée en image puis assemblée dans un PDF)
async function pdfPages(){
  const sh=$('#sheet'),z=sh.style.zoom;sh.style.zoom='';
  const cs=getComputedStyle(page),H=page.offsetHeight,pad=`${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`;
  const rules=[...document.styleSheets[0].cssRules].filter(r=>r.selectorText&&r.selectorText.startsWith('#page')).map(r=>r.cssText).join('');
  const c=page.cloneNode(true);c.removeAttribute('contenteditable');
  c.style.cssText=`background:#fff;width:794px;min-height:${H}px;box-sizing:border-box;padding:${pad}`;
  sh.style.zoom=z;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="${H}"><foreignObject width="794" height="${H}"><style xmlns="http://www.w3.org/1999/xhtml">${rules}</style>${new XMLSerializer().serializeToString(c)}</foreignObject></svg>`;
  const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
  const S=1.5,out=[];
  for(let i=0;i<PAGES;i++){
    const cv=document.createElement('canvas');cv.width=Math.round(794*S);cv.height=Math.round(PH*S);
    const x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.scale(S,S);x.drawImage(img,0,-i*STEP);
    const bin=atob(cv.toDataURL('image/jpeg',.92).split(',')[1]),u=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)u[k]=bin.charCodeAt(k);
    out.push({d:u,w:cv.width,h:cv.height});
  }
  return out;
}
function pdfFrom(js){
  const E=new TextEncoder(),parts=[],off=[];let len=0;
  const put=x=>{const b=typeof x==='string'?E.encode(x):x;parts.push(b);len+=b.length;};
  const obj=(n,f)=>{off[n]=len;put(n+' 0 obj\n');f();put('\nendobj\n');};
  put('%PDF-1.4\n');const n=js.length;
  obj(1,()=>put('<</Type/Catalog/Pages 2 0 R>>'));
  obj(2,()=>put(`<</Type/Pages/Count ${n}/Kids [${js.map((_,i)=>(3+3*i)+' 0 R').join(' ')}]>>`));
  js.forEach((j,i)=>{
    const p=3+3*i,c='q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    obj(p,()=>put(`<</Type/Page/Parent 2 0 R/MediaBox [0 0 595.28 841.89]/Resources<</XObject<</Im0 ${p+2} 0 R>>>>/Contents ${p+1} 0 R>>`));
    obj(p+1,()=>put(`<</Length ${c.length}>>\nstream\n${c}\nendstream`));
    obj(p+2,()=>{put(`<</Type/XObject/Subtype/Image/Width ${j.w}/Height ${j.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${j.d.length}>>\nstream\n`);put(j.d);put('\nendstream');});
  });
  const xr=len,tot=3*n+3;
  put(`xref\n0 ${tot}\n0000000000 65535 f \n`);
  for(let k=1;k<tot;k++)put(String(off[k]).padStart(10,'0')+' 00000 n \n');
  put(`trailer\n<</Size ${tot}/Root 1 0 R>>\nstartxref\n${xr}\n%%EOF`);
  return new Blob(parts,{type:'application/pdf'});
}
$('#savePdf').onclick=async()=>{
  $('#saved').textContent='Création du PDF…';
  try{layout();await save('pdf',pdfFrom(await pdfPages()));$('#saved').textContent='';}
  catch(e){$('#saved').textContent='PDF impossible ici : utilisez Imprimer > Enregistrer en PDF';console.error(e);}
};
schedLayout();


(async()=>{
  if(window.claude&&claude.use){try{dl=await claude.use('downloads');}catch(e){}if(!dl)document.querySelectorAll('.dl').forEach(b=>b.hidden=true);}
})();

if(entryMode&&window.opener){
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.opener||!event.data)return;
    if(event.data.type==='frumence-editor-init'){
      const text=typeof event.data.text==='string'?event.data.text:'';
      if(text){
        page.innerHTML=text.split(/\r?\n/).map(line=>'<p>'+line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</p>').join('');
      }else{
        page.innerHTML='<h1>Titre du document</h1><p>Commencez à écrire ici. Sélectionnez du texte pour le mettre en forme avec le ruban au-dessus.</p>';
      }
      if(typeof event.data.title==='string'&&event.data.title.trim())$('#title').value=event.data.title.trim();
      changed();
      page.focus();
    }
  });
  insertEntry.addEventListener('click',()=>{
    window.opener.postMessage({type:'frumence-editor-result',text:page.innerText},location.origin);
    window.close();
  });
  window.opener.postMessage({type:'frumence-editor-ready'},location.origin);
}
