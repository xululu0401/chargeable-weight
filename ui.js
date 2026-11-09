(function(){
'use strict';
var C=window.AppCore;
var $=function(id){return document.getElementById(id);};
var STORE='chargeable-weight-v1';
var items=[];

function esc(s){return String(s===null||s===undefined?'':s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function yuan(n){return (Math.round(Number(n)*100)/100).toFixed(2);}
function num(n,d){var v=Number(n);return Number.isFinite(v)?v.toFixed(d===undefined?2:d):'—';}

// ── 物品行 ──────────────────────────────────────────────────
function fld(cls,label,val,aria){
  return '<label class="f"><span>'+esc(label)+'</span>'
    +'<input type="text" inputmode="decimal" class="'+cls+'" value="'+esc(val)+'" aria-label="'+esc(aria)+'"></label>';
}
function itemHTML(it,i){
  return '<div class="item" data-i="'+i+'">'
    +'<div class="item-head"><span class="idx">'+(i+1)+'</span>'
    +'<input type="text" class="i-name" maxlength="24" value="'+esc(it.name)+'" aria-label="第'+(i+1)+'行名称" placeholder="名称，如 书籍箱">'
    +'<button type="button" class="mini del" data-del="'+i+'">删除</button></div>'
    +'<div class="grid5">'
    +fld('i-w','实重 kg',it.weightKg,'第'+(i+1)+'行实重公斤')
    +fld('i-l','长 cm',it.Lcm,'第'+(i+1)+'行长厘米')
    +fld('i-wd','宽 cm',it.Wcm,'第'+(i+1)+'行宽厘米')
    +fld('i-h','高 cm',it.Hcm,'第'+(i+1)+'行高厘米')
    +fld('i-q','件数',it.qty,'第'+(i+1)+'行件数')
    +'</div></div>';
}
function renderItems(){
  var box=$('items');
  box.innerHTML=items.map(itemHTML).join('');
  $('addRow').disabled=items.length>=C.LIMITS.MAX_ROWS;
  $('rowNote').textContent='共 '+items.length+' 行（最多 '+C.LIMITS.MAX_ROWS+' 行），'
    +'件数合计 '+items.reduce(function(s,it){return s+(Number(it.qty)||0);},0)
    +' 件（最多 '+C.LIMITS.MAX_UNITS+' 件，超过请拆成多次计算）。';
}
function blankItem(){return {name:'',weightKg:'',Lcm:'',Wcm:'',Hcm:'',qty:'1'};}

// ── 读取表单 ────────────────────────────────────────────────
function readInput(){
  var list=[].slice.call(document.querySelectorAll('#items .item'));
  var its=list.map(function(el,i){
    var g=function(cls){var n=el.querySelector('.'+cls);return n?n.value.trim():'';};
    return {name:g('i-name'),weightKg:g('i-w'),Lcm:g('i-l'),Wcm:g('i-wd'),Hcm:g('i-h'),qty:g('i-q')};
  });
  return {
    items:its,
    rate:{firstKg:$('firstKg').value,firstPrice:$('firstPrice').value,stepKg:$('stepKg').value,
      stepPrice:$('stepPrice').value,divisor:$('divisor').value,roundingKg:$('roundingKg').value,minKg:$('minKg').value},
    maxParcels:$('maxParcels').value,
    mergeFactor:$('mergeFactor').value,
    mergeOverride:{on:$('ovOn').checked,Lcm:$('ovL').value,Wcm:$('ovW').value,Hcm:$('ovH').value}
  };
}
function fillForm(inp){
  items=(inp.items||[]).map(function(it){return {name:it.name||'',weightKg:String(it.weightKg||''),
    Lcm:String(it.Lcm||''),Wcm:String(it.Wcm||''),Hcm:String(it.Hcm||''),qty:String(it.qty||'1')};});
  if(!items.length)items=[blankItem()];
  renderItems();
  var r=inp.rate||{};
  $('firstKg').value=r.firstKg!==undefined?r.firstKg:'1';
  $('firstPrice').value=r.firstPrice!==undefined?r.firstPrice:'10';
  $('stepKg').value=r.stepKg!==undefined?r.stepKg:'1';
  $('stepPrice').value=r.stepPrice!==undefined?r.stepPrice:'5';
  $('divisor').value=r.divisor!==undefined?r.divisor:'6000';
  $('roundingKg').value=r.roundingKg!==undefined?r.roundingKg:'0.5';
  $('minKg').value=r.minKg!==undefined?r.minKg:'1';
  $('maxParcels').value=inp.maxParcels!==undefined?inp.maxParcels:'3';
  $('mergeFactor').value=inp.mergeFactor!==undefined?inp.mergeFactor:'1.10';
  var ov=inp.mergeOverride||{};
  $('ovOn').checked=!!ov.on;
  $('ovL').value=ov.Lcm||'';$('ovW').value=ov.Wcm||'';$('ovH').value=ov.Hcm||'';
  $('ovBox').hidden=!ov.on;
}

// ── 结果渲染 ────────────────────────────────────────────────
function blockCard(b,idx){
  return '<div class="card"><p><strong>包裹 '+(idx+1)+'</strong>：'+esc(b.names.join(' + '))
    +' <span class="tag">'+b.count+' 件</span>'
    +(b.byVolume?' <span class="tag bad">体积重主导</span>':' <span class="tag good">实重主导</span>')
    +(b.override?' <span class="tag">用了实测外箱</span>':'')+'</p>'
    +'<p class="num">实重 '+num(b.weightKg)+' kg　外箱 '+num(b.Lcm,1)+'×'+num(b.Wcm,1)+'×'+num(b.Hcm,1)
    +' cm（'+(b.override?'实测':'估算')+'，体积 '+num(b.boxVcm3,0)+' cm³）</p>'
    +'<p class="num">体积重 '+num(b.volWeightKg,3)+' kg（抛重比 '+num(b.volWeightRatio)+'）　→　'
    +'<strong>计费重 '+num(b.chargeKg)+' kg　运费 '+yuan(b.freightYuan)+' 元</strong></p></div>';
}
function schemeRow(s){
  return '<tr'+(s.isBest?' class="cur"':'')+(s.outOfLimit?' class="dim"':'')+'><td data-label="方案">'+esc(s.label)
    +(s.isBest?' <span class="tag good">最优</span>':'')
    +(s.outOfLimit?' <span class="tag bad">超出上限</span>':'')+'</td>'
    +'<td data-label="包裹数">'+s.k+'</td>'
    +'<td data-label="总运费">'+yuan(s.totalYuan)+' 元</td>'
    +'<td data-label="比逐件省">'+(s.savingVsSoloC>0?yuan(s.savingVsSoloYuan)+' 元':'—')+'</td></tr>';
}
function render(r){
  var h='';
  h+='<div class="metric">推荐寄 <strong>'+r.best.k+'</strong> 个包裹：总运费 <strong>'+yuan(r.best.totalYuan)+'</strong> 元'
    +(r.best.savingVsSoloC>0?'，比全部逐件单独寄省 <strong>'+yuan(r.best.savingVsSoloYuan)+'</strong> 元（'+num(r.best.pct,1)+'%）':'')
    +'</div>';
  h+='<div class="stats">'
    +'<div><strong>'+r.units+'</strong><span>件（'+r.rowCount+' 个规格）</span></div>'
    +'<div><strong>'+yuan(r.soloYuan)+'</strong><span>全部逐件单独寄（元）</span></div>'
    +'<div><strong>'+yuan(r.singleBox.totalYuan)+'</strong><span>全部合并成 1 个包裹（元）</span></div>'
    +'<div><strong>'+num(r.totalWeightKg)+'</strong><span>总实重（kg）</span></div>'
    +'<div><strong>'+num(r.totalVolCm3,0)+'</strong><span>总体积（cm³）</span></div>'
    +'<div><strong>'+r.partitions+'</strong><span>枚举的分块方案数</span></div>'
    +'</div>';

  h+='<h3>最优方案的每个包裹</h3>';
  h+='<div class="blocks">'+r.best.blocks.map(blockCard).join('')+'</div>';

  h+='<h3>方案对照</h3><div class="scroll"><table class="stack"><thead><tr><th>方案</th><th>包裹数</th><th>总运费</th><th>比逐件省</th></tr></thead><tbody>'
    +r.schemes.map(schemeRow).join('')+'</tbody></table></div>';

  h+='<h3>逐规格诊断（每个规格单独寄的话）</h3><div class="scroll"><table class="stack"><thead><tr>'
    +'<th>规格</th><th>件数</th><th>实重kg</th><th>体积cm³</th><th>体积重kg</th><th>抛重比</th>'
    +'<th>主导</th><th>计费重kg</th><th>进位损耗</th><th>运费元</th><th>泡重多付</th></tr></thead><tbody>';
  r.rows.forEach(function(x){
    h+='<tr><td data-label="规格">'+esc(x.name)+'</td>'
      +'<td data-label="件数">'+x.qty+'</td>'
      +'<td data-label="实重 kg">'+num(x.weightKg)+'</td>'
      +'<td data-label="体积 cm³">'+num(x.Vcm3,0)+'</td>'
      +'<td data-label="体积重 kg">'+num(x.volWeightKg,3)+'</td>'
      +'<td data-label="抛重比">'+num(x.volWeightRatio)+'</td>'
      +'<td data-label="主导">'+(x.byVolume?'<span class="bad">体积重</span>':(x.dominant==='相等'?'相等':'实重'))+'</td>'
      +'<td data-label="计费重 kg">'+num(x.chargeKg)+'</td>'
      +'<td data-label="进位损耗 kg">'+num(x.carryKg,3)+'</td>'
      +'<td data-label="单件运费">'+yuan(x.freightYuan)+' 元</td>'
      +'<td data-label="泡重多付">'+(x.overpayYuan>0?'<span class="bad">'+yuan(x.overpayYuan)+' 元</span>':'—')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  h+='<p class="legend">「进位损耗」= 计费重 − max(实重, 体积重) 的差，由进位规则造成；'
    +'「泡重多付」= 实际运费 − 只按实重计费的运费，也就是体积重和进位一起多收的部分（按该规格全部件数合计）。</p>';

  h+='<h3>体积重除数换一换（当前 '+r.rate.divisor+'）</h3><div class="scroll"><table class="stack"><thead><tr>'
    +'<th>除数 cm³/kg</th><th>逐规格体积重合计 kg</th><th>全部逐件寄</th><th>最优方案</th><th>最优包裹数</th></tr></thead><tbody>';
  r.divSens.forEach(function(s){
    h+='<tr'+(s.current?' class="cur"':'')+'><td data-label="除数">'+s.divisor+(s.current?' <span class="tag">当前</span>':'')+'</td>'
      +'<td data-label="体积重合计">'+num(s.soloVolWeightKg)+'</td>'
      +'<td data-label="全部逐件寄">'+yuan(s.soloYuan)+' 元</td>'
      +'<td data-label="最优方案">'+yuan(s.bestYuan)+' 元</td>'
      +'<td data-label="最优包裹数">'+s.bestK+'</td></tr>';
  });
  h+='</tbody></table></div>';

  h+='<h3>进位规则换一换（当前 '+esc(r.rate.roundingLabel)+'）</h3><div class="scroll"><table class="stack"><thead><tr>'
    +'<th>进位到</th><th>逐规格计费重合计 kg</th><th>全部逐件寄</th><th>最优方案</th><th>最优包裹数</th></tr></thead><tbody>';
  r.roundSens.forEach(function(s){
    h+='<tr'+(s.current?' class="cur"':'')+'><td data-label="进位到">'+esc(s.label)+(s.current?' <span class="tag">当前</span>':'')+'</td>'
      +'<td data-label="计费重合计">'+num(s.soloChargeKg)+'</td>'
      +'<td data-label="全部逐件寄">'+yuan(s.soloYuan)+' 元</td>'
      +'<td data-label="最优方案">'+yuan(s.bestYuan)+' 元</td>'
      +'<td data-label="最优包裹数">'+s.bestK+'</td></tr>';
  });
  h+='</tbody></table></div>';
  var sameMoney=r.roundSens.every(function(s){return Math.abs(s.soloYuan-r.roundSens[0].soloYuan)<1e-9;});
  h+='<p class="legend">进位规则改变的是<strong>计费重</strong>（上表第 2 列随进位步长单调不减），'
    +(sameMoney?'但本场景下因为它没跨过续重步长，<strong>运费一分没变</strong>——这是真实计算结果，不是没算。'
      :'本场景下它也确实改变了运费。')+'</p>';

  h+='<h3>把体积压一压会怎样</h3><div class="scroll"><table class="stack"><thead><tr>'
    +'<th>三边压到</th><th>体积约</th><th>最优方案总价</th><th>比现在的最优省</th><th>比全部逐件寄省</th></tr></thead><tbody>';
  r.shrinkSim.forEach(function(s){
    var volPct=Math.round(Math.pow(s.keepPct/100,3)*1000)/10;
    h+='<tr><td data-label="三边压到">'+s.keepPct+'%</td><td data-label="体积约">'+num(volPct,1)+'%</td>'
      +'<td data-label="最优方案总价">'+yuan(s.totalYuan)+' 元</td>'
      +'<td data-label="比现在省">'+(s.savingVsBestC>0?yuan(s.savingVsBestYuan)+' 元':'—')+'</td>'
      +'<td data-label="比逐件省">'+yuan(s.savingVsSoloYuan)+' 元</td></tr>';
  });
  h+='</tbody></table></div>';
  h+='<div class="buttons"><button type="button" id="sh90">把三边压到 90% 并重算</button>'
    +'<button type="button" id="sh80">把三边压到 80% 并重算</button>'
    +'<button type="button" id="sh70">把三边压到 70% 并重算</button>'
    +'<button type="button" id="shReset">还原成压缩前</button></div>'
    +'<p class="legend">按上面的按钮会<strong>真的改动左侧的长宽高</strong>（三边各乘 ∛系数后四舍五入到 0.1 cm），再重新计算；'
    +'「还原成压缩前」回到按下按钮之前的那一组尺寸。这是把建议变成动作，不是只给一句劝告。</p>';

  h+='<h3>建议</h3><ul class="advice">'+r.advice.map(function(a){return '<li>'+esc(a.text)+'</li>';}).join('')+'</ul>';
  h+='<div class="notice">'+r.warnings.map(function(w){return esc(w);}).join('<br>')+'</div>';

  $('result').innerHTML=h;
  $('downloads').style.display='flex';
  $('error').textContent='';
  bindShrink();
}

// ── 压缩按钮 ────────────────────────────────────────────────
var backupDims=null;
function bindShrink(){
  var map={sh90:90,sh80:80,sh70:70};
  Object.keys(map).forEach(function(id){
    var el=$(id);if(!el)return;
    el.addEventListener('click',function(){
      var keep=map[id]/100,sc=Math.cbrt(keep);
      if(!backupDims)backupDims=[].slice.call(document.querySelectorAll('#items .item')).map(function(el){
        var g=function(c){var n=el.querySelector('.'+c);return n?n.value:'';};
        return {Lcm:g('i-l'),Wcm:g('i-wd'),Hcm:g('i-h')};});
      [].slice.call(document.querySelectorAll('#items .item')).forEach(function(el){
        ['i-l','i-wd','i-h'].forEach(function(c){
          var n=el.querySelector('.'+c);if(!n)return;
          var v=Number(n.value);
          if(!Number.isFinite(v)||v<=0)return;
          n.value=String(Math.max(1,Math.round(v*sc*10)/10));
        });
      });
      setMessage('已把所有规格的三边按 ∛'+(keep*100).toFixed(0)+'% 缩放（体积约 '+(keep*keep*keep*100).toFixed(0)+'%），并重新计算。');
      run();
    });
  });
  var rz=$('shReset');
  if(rz)rz.addEventListener('click',function(){
    if(!backupDims){setMessage('还没有压缩过，无需还原。');return;}
    [].slice.call(document.querySelectorAll('#items .item')).forEach(function(el,i){
      var b=backupDims[i];if(!b)return;
      var set=function(c,v){var n=el.querySelector('.'+c);if(n)n.value=v;};
      set('i-l',b.Lcm);set('i-wd',b.Wcm);set('i-h',b.Hcm);
    });
    backupDims=null;
    setMessage('已还原成压缩前的尺寸并重新计算。');
    run();
  });
}
function setMessage(t){$('message').textContent=t||'';}

// ── 主流程 ──────────────────────────────────────────────────
var lastSolved=null;
function run(){
  var inp;
  try{inp=readInput();}catch(e){$('error').textContent='读取输入失败：'+e.message;return;}
  var r;
  try{
    r=C.solve(inp);
  }catch(e){
    lastSolved=null;
    $('result').innerHTML='<p class="hint">修正左侧提示的输入后会自动重新计算。</p>';
    $('downloads').style.display='none';
    $('error').textContent='✕ '+(e.userMessage||e.message);
    return;
  }
  lastSolved=r;
  window.__lastResult=r;
  render(r);
  autosave();
}

// ── 持久化 ──────────────────────────────────────────────────
var saveTimer=null;
function snapshot(){
  var inp=readInput();
  return {v:1,savedAt:new Date().toISOString(),input:inp};
}
function autosave(){
  if(saveTimer)clearTimeout(saveTimer);
  saveTimer=setTimeout(function(){
    try{
      localStorage.setItem(STORE,JSON.stringify(snapshot()));
      $('savedNote').textContent='已自动保存到本机（'+new Date().toLocaleTimeString('zh-CN')+'）；刷新页面会自动恢复。';
    }catch(e){
      $('savedNote').textContent='自动保存失败：'+(e&&e.message?e.message:'浏览器拒绝写入本地存储');
    }
  },500);
}
function restoreFrom(obj,src){
  if(!obj||!obj.input){setMessage('没有可恢复的存档。');return;}
  fillForm(obj.input);
  backupDims=null;
  setMessage('已从'+src+'恢复'+(obj.savedAt?'（存档时间 '+obj.savedAt+'）':'')+'。');
  run();
}

// ── 导出 ────────────────────────────────────────────────────
function csvCell(v){var s=String(v===null||v===undefined?'':v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function toCSV(r){
  var L=[];
  L.push(['# 计费重对账台 导出','生成时间 '+new Date().toISOString()].map(csvCell).join(','));
  L.push(['# 费率','首重 '+r.rate.firstKg+' kg = '+yuan(r.rate.firstYuan)+' 元','续重每 '+r.rate.stepKg+' kg = '+yuan(r.rate.stepYuan)+' 元',
    '体积重除数 '+r.rate.divisor,'进位 '+r.rate.roundingLabel,'最低计费重 '+r.rate.minKg+' kg','合并体积系数 '+num(r.mergeFactor)].map(csvCell).join(','));
  L.push('');
  L.push(['规格','件数','实重kg','长cm','宽cm','高cm','体积cm3','体积重kg','抛重比','主导','计费重kg','进位损耗kg','单件运费元','单件按实重运费元','泡重多付元','整行运费元'].map(csvCell).join(','));
  r.rows.forEach(function(x){
    L.push([x.name,x.qty,num(x.weightKg),num(x.Lcm,1),num(x.Wcm,1),num(x.Hcm,1),num(x.Vcm3,0),num(x.volWeightKg,3),
      num(x.volWeightRatio),x.dominant,num(x.chargeKg),num(x.carryKg,3),yuan(x.freightYuan),yuan(x.weightOnlyFreightYuan),
      yuan(x.overpayYuan),yuan(x.rowFreightYuan)].map(csvCell).join(','));
  });
  L.push('');
  L.push(['方案','包裹数','总运费元','比逐件省元'].map(csvCell).join(','));
  r.schemes.forEach(function(s){L.push([s.label,s.k,yuan(s.totalYuan),yuan(s.savingVsSoloYuan)].map(csvCell).join(','));});
  L.push('');
  L.push(['最优方案-包裹','包含规格','件数','实重kg','外箱长cm','外箱宽cm','外箱高cm','外箱体积cm3','体积重kg','计费重kg','主导','运费元'].map(csvCell).join(','));
  r.best.blocks.forEach(function(b,i){
    L.push(['包裹'+(i+1),b.names.join(' + '),b.count,num(b.weightKg),num(b.Lcm,1),num(b.Wcm,1),num(b.Hcm,1),
      num(b.boxVcm3,0),num(b.volWeightKg,3),num(b.chargeKg),b.byVolume?'体积重':'实重',yuan(b.freightYuan)].map(csvCell).join(','));
  });
  L.push('');
  L.push(['体积重除数','逐规格体积重合计kg','全部逐件寄元','最优方案元','最优包裹数'].map(csvCell).join(','));
  r.divSens.forEach(function(s){L.push([s.divisor,num(s.soloVolWeightKg),yuan(s.soloYuan),yuan(s.bestYuan),s.bestK].map(csvCell).join(','));});
  L.push('');
  L.push(['进位规则','逐规格计费重合计kg','全部逐件寄元','最优方案元','最优包裹数'].map(csvCell).join(','));
  r.roundSens.forEach(function(s){L.push([s.label,num(s.soloChargeKg),yuan(s.soloYuan),yuan(s.bestYuan),s.bestK].map(csvCell).join(','));});
  return '\uFEFF'+L.join('\r\n')+'\r\n';
}
function toMD(r){
  var L=[];
  L.push('# 计费重对账台 · 结果说明');
  L.push('');
  L.push('生成时间：'+new Date().toISOString());
  L.push('');
  L.push('## 结论');
  L.push('');
  L.push('- 推荐寄 **'+r.best.k+' 个包裹**，总运费 **'+yuan(r.best.totalYuan)+' 元**。');
  L.push('- 全部逐件单独寄（'+r.units+' 个包裹）要 '+yuan(r.soloYuan)+' 元，最优方案省 '+yuan(r.best.savingVsSoloYuan)+' 元（'+num(r.best.pct,1)+'%）。');
  L.push('- 全部合并成 1 个包裹要 '+yuan(r.singleBox.totalYuan)+' 元（按 '+num(r.singleBox.chargeKg)+' kg 计费）。');
  L.push('- 共 '+r.units+' 件 / '+r.rowCount+' 个规格，总实重 '+num(r.totalWeightKg)+' kg，总体积 '+num(r.totalVolCm3,0)+' cm³，枚举了 '+r.partitions+' 种分块方案。');
  L.push('');
  L.push('## 费率假设（用户填写）');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| 首重 | '+r.rate.firstKg+' kg = '+yuan(r.rate.firstYuan)+' 元 |');
  L.push('| 续重 | 每 '+r.rate.stepKg+' kg = '+yuan(r.rate.stepYuan)+' 元 |');
  L.push('| 体积重除数 | '+r.rate.divisor+' cm³/kg |');
  L.push('| 进位规则 | 向上取整到 '+r.rate.roundingLabel+' |');
  L.push('| 最低计费重 | '+r.rate.minKg+' kg |');
  L.push('| 合并体积系数 | '+num(r.mergeFactor)+' |');
  L.push('| 最多包裹数 | '+r.maxParcels+' |');
  L.push('');
  L.push('## 最优方案的每个包裹');
  L.push('');
  L.push('| 包裹 | 包含规格 | 件数 | 实重 kg | 外箱 cm | 外箱体积 cm³ | 体积重 kg | 计费重 kg | 主导 | 运费 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  r.best.blocks.forEach(function(b,i){
    L.push('| '+(i+1)+' | '+b.names.join(' + ')+' | '+b.count+' | '+num(b.weightKg)+' | '
      +num(b.Lcm,1)+'×'+num(b.Wcm,1)+'×'+num(b.Hcm,1)+' | '+num(b.boxVcm3,0)+' | '+num(b.volWeightKg,3)
      +' | '+num(b.chargeKg)+' | '+(b.byVolume?'体积重':'实重')+' | '+yuan(b.freightYuan)+' 元 |');
  });
  L.push('');
  L.push('## 逐规格诊断（每个规格单独寄）');
  L.push('');
  L.push('| 规格 | 件数 | 实重 kg | 体积重 kg | 抛重比 | 主导 | 计费重 kg | 单件运费 | 泡重多付 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  r.rows.forEach(function(x){
    L.push('| '+x.name+' | '+x.qty+' | '+num(x.weightKg)+' | '+num(x.volWeightKg,3)+' | '+num(x.volWeightRatio)
      +' | '+x.dominant+' | '+num(x.chargeKg)+' | '+yuan(x.freightYuan)+' 元 | '+(x.overpayYuan>0?yuan(x.overpayYuan)+' 元':'—')+' |');
  });
  L.push('');
  L.push('## 方案对照');
  L.push('');
  L.push('| 方案 | 包裹数 | 总运费 | 比逐件省 |');
  L.push('|---|---|---|---|');
  r.schemes.forEach(function(s){L.push('| '+s.label+' | '+s.k+' | '+yuan(s.totalYuan)+' 元 | '+yuan(s.savingVsSoloYuan)+' 元 |');});
  L.push('');
  L.push('## 敏感性');
  L.push('');
  L.push('| 体积重除数 | 逐规格体积重合计 kg | 全部逐件寄 | 最优方案 | 最优包裹数 |');
  L.push('|---|---|---|---|---|');
  r.divSens.forEach(function(s){L.push('| '+s.divisor+' | '+num(s.soloVolWeightKg)+' | '+yuan(s.soloYuan)+' 元 | '+yuan(s.bestYuan)+' 元 | '+s.bestK+' |');});
  L.push('');
  L.push('| 进位规则 | 逐规格计费重合计 kg | 全部逐件寄 | 最优方案 | 最优包裹数 |');
  L.push('|---|---|---|---|---|');
  r.roundSens.forEach(function(s){L.push('| '+s.label+' | '+num(s.soloChargeKg)+' | '+yuan(s.soloYuan)+' 元 | '+yuan(s.bestYuan)+' 元 | '+s.bestK+' |');});
  L.push('');
  L.push('## 建议');
  L.push('');
  r.advice.forEach(function(a){L.push('- '+a.text);});
  L.push('');
  L.push('## 边界与免责');
  L.push('');
  r.warnings.forEach(function(w){L.push('- '+w);});
  L.push('- 本工具只做计费重与运费的算术对账：不装箱、不查任何快递公司的真实报价、不给出寄件建议的物流合规判断。');
  return L.join('\n')+'\n';
}
function download(name,text,mime){
  var blob=new Blob([text],{type:mime||'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1500);
}
function drawCard(r){
  var W=1080,H=1350,L=96,R=W-96,MAXW=R-L;
  var cv=document.createElement('canvas');
  cv.width=W;cv.height=H;
  var x=cv.getContext('2d');
  var FONT='"PingFang SC",system-ui,-apple-system,sans-serif';
  function setFont(w,size){x.font=w+' '+size+'px '+FONT;}
  // 按宽度逐字换行；超过 maxLines 时末行截断加省略号，保证不越界
  var NO_START='）｝】」』》〉、。，；：？！…·)]}%';
  var NO_END='（｛【「『《〈([{';
  function wrap(text,size,weight,maxLines){
    setFont(weight,size);
    var out=[],cur='',i;
    for(i=0;i<text.length;i++){
      var ch=text[i],test=cur+ch;
      if(cur&&x.measureText(test).width>MAXW){
        if(NO_START.indexOf(ch)>=0){out.push(cur+ch);cur='';continue;}   // 收尾标点不另起一行
        var carry='';
        while(cur.length>1&&NO_END.indexOf(cur.charAt(cur.length-1))>=0){   // 开引号不留行尾
          carry=cur.charAt(cur.length-1)+carry;cur=cur.slice(0,-1);
        }
        out.push(cur);cur=carry+ch;
      } else cur=test;
    }
    if(cur)out.push(cur);
    if(out.length>maxLines){
      out=out.slice(0,maxLines);
      var last=out[maxLines-1];
      setFont(weight,size);
      while(last.length>1&&x.measureText(last+'…').width>MAXW)last=last.slice(0,-1);
      out[maxLines-1]=last+'…';
    }
    return out;
  }
  var y=130;
  function draw(text,size,weight,color,maxLines,gap){
    var ls=wrap(text,size,weight,maxLines||1);
    x.fillStyle=color;
    ls.forEach(function(lineText){
      setFont(weight,size);
      x.fillText(lineText,L,y);
      y+=(gap||Math.round(size*1.35));
    });
    return ls.length;
  }
  function divider(){x.strokeStyle='#d9e3ee';x.lineWidth=2;x.beginPath();x.moveTo(L,y);x.lineTo(R,y);x.stroke();y+=8;}

  x.fillStyle='#eef3f8';x.fillRect(0,0,W,H);
  x.fillStyle='#ffffff';x.fillRect(48,48,W-96,H-96);

  draw('计费重对账台 · CHARGEABLE WEIGHT LEDGER',27,700,'#2d5f96',1,78);
  draw('推荐寄 '+r.best.k+' 个包裹',56,700,'#22344e',1,58);
  draw('总运费',25,400,'#5a6d84',1,86);
  setFont(700,80);x.fillStyle='#a23b28';x.fillText(yuan(r.best.totalYuan)+' 元',L,y);y+=70;
  draw('比全部逐件单独寄省 '+yuan(r.best.savingVsSoloYuan)+' 元（'+num(r.best.pct,1)+'%）',31,700,'#2b6b4f',1,44);
  draw('全部逐件寄 '+yuan(r.soloYuan)+' 元　·　全部合并 1 个包裹 '+yuan(r.singleBox.totalYuan)+' 元',24,400,'#5a6d84',1,36);
  draw(r.units+' 件 / '+r.rowCount+' 个规格　·　费率 首重 '+r.rate.firstKg+' kg='+yuan(r.rate.firstYuan)+' 元，续重 '+r.rate.stepKg+' kg='+yuan(r.rate.stepYuan)+' 元',24,400,'#5a6d84',1,36);
  draw('体积重除数 '+r.rate.divisor+' cm³/kg　·　进位 '+r.rate.roundingLabel+'　·　枚举 '+r.partitions+' 种分块',24,400,'#5a6d84',1,44);
  divider();
  y+=34;
  draw('每个包裹（'+r.best.k+' 个）',30,700,'#22344e',1,44);
  r.best.blocks.slice(0,3).forEach(function(b,i){
    draw('包裹 '+(i+1)+'：'+b.names.join(' + ')+(b.count>1?'（'+b.count+' 件）':''),26,700,'#2d5f96',2,34);
    draw('实重 '+num(b.weightKg)+' kg　外箱 '+num(b.Lcm,1)+'×'+num(b.Wcm,1)+'×'+num(b.Hcm,1)+' cm　体积重 '+num(b.volWeightKg,3)+' kg',
      22,400,'#5a6d84',2,30);
    draw('计费重 '+num(b.chargeKg)+' kg（'+(b.byVolume?'体积重主导':'实重主导')+'）　运费 '+yuan(b.freightYuan)+' 元',25,700,'#22344e',1,34);
  });
  if(r.best.blocks.length>3)draw('（其余 '+(r.best.blocks.length-3)+' 个包裹见页面明细）',21,400,'#718095',1,30);
  y+=14;
  divider();
  y+=30;
  var worst=r.rows.slice().sort(function(a,b){return b.volWeightRatio-a.volWeightRatio;})[0];
  draw('抛重最狠的规格',24,700,'#22344e',1,34);
  draw(worst.name+'：实重 '+num(worst.weightKg)+' kg，按 '+num(worst.chargeKg)+' kg 计费（抛重 '+num(worst.volWeightRatio)+' 倍，泡重多付 '+yuan(worst.overpayYuan)+' 元）',
    22,400,'#a23b28',2,36);
  draw('本卡数字与页面同一次计算一致。默认样例为虚构示例，费率与物品由你填写，不代表任何快递公司报价；本工具只做计费重与运费算术对账，不装箱、不联网、不查真实报价。',
    19,400,'#718095',2,26);
  return cv;
}

// ── 事件绑定 ────────────────────────────────────────────────
function boot(){
  fillForm(C.sample);
  var saved=null;
  try{saved=localStorage.getItem(STORE);}catch(e){saved=null;}
  if(saved){
    try{restoreFrom(JSON.parse(saved),'本机自动存档');}catch(e){}
  }
  run();

  var panel=$('inputPanel');
  panel.addEventListener('input',function(e){
    if(e.target&&e.target.id==='ovOn')$('ovBox').hidden=!$('ovOn').checked;
    run();
  });
  panel.addEventListener('change',function(e){
    if(e.target&&e.target.id==='ovOn')$('ovBox').hidden=!$('ovOn').checked;
    run();
  });
  $('items').addEventListener('click',function(e){
    var b=e.target.closest?e.target.closest('.del'):null;
    if(!b)return;
    var i=Number(b.getAttribute('data-del'));
    if(items.length<=1){setMessage('至少要保留一行物品。');return;}
    items.splice(i,1);renderItems();run();
  });
  $('addRow').addEventListener('click',function(){
    if(items.length>=C.LIMITS.MAX_ROWS)return;
    var inp=readInput();
    items=inp.items.concat([blankItem()]);
    renderItems();run();
    setMessage('已加一行，填好重量与三边即自动计算。');
  });
  $('demo').addEventListener('click',function(){
    fillForm(C.sample);backupDims=null;setMessage('已载入虚构示例（搬家寄 5 个规格）。');run();
  });
  $('save').addEventListener('click',function(){
    try{
      localStorage.setItem(STORE,JSON.stringify(snapshot()));
      setMessage('已保存到本机（同一浏览器刷新后自动恢复）。');
      $('savedNote').textContent='已保存到本机。';
    }catch(e){setMessage('保存失败：'+(e&&e.message?e.message:'浏览器拒绝写入本地存储'));}
  });
  $('restore').addEventListener('click',function(){
    var s=null;
    try{s=localStorage.getItem(STORE);}catch(e){s=null;}
    if(!s){setMessage('本机还没有存档，先点「保存到本机」。');return;}
    try{restoreFrom(JSON.parse(s),'本机存档');}catch(e){setMessage('存档解析失败：'+e.message);}
  });
  $('backup').addEventListener('click',function(){
    download('计费重对账台-备份.json',JSON.stringify(snapshot(),null,2),'application/json');
    setMessage('已下载 JSON 备份。');
  });
  $('import').addEventListener('click',function(){$('imports').click();});
  $('imports').addEventListener('change',function(e){
    var f=e.target.files&&e.target.files[0];
    if(!f)return;
    var fr=new FileReader();
    fr.onload=function(){
      try{restoreFrom(JSON.parse(String(fr.result)),'导入的备份文件');}
      catch(err){setMessage('导入失败：'+err.message);}
    };
    fr.onerror=function(){setMessage('读取文件失败。');};
    fr.readAsText(f);
    e.target.value='';
  });
  $('csv').addEventListener('click',function(){if(!lastSolved)return;download('计费重对账-明细.csv',toCSV(lastSolved),'text/csv;charset=utf-8');});
  $('md').addEventListener('click',function(){if(!lastSolved)return;download('计费重对账-说明.md',toMD(lastSolved),'text/markdown;charset=utf-8');});
  $('json').addEventListener('click',function(){download('计费重对账台-备份.json',JSON.stringify(snapshot(),null,2),'application/json');});
  $('png').addEventListener('click',function(){
    if(!lastSolved)return;
    var cv=drawCard(lastSolved);
    cv.toBlob(function(b){
      var url=URL.createObjectURL(b),a=document.createElement('a');
      a.href=url;a.download='计费重对账-结果卡.png';
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1500);
    },'image/png');
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();
