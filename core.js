(function(g){
'use strict';
// 计费重对账台 · 核心计算（纯函数，无 DOM、无网络）
// 口径、公式与边界见 ../需求与调研.md「需求简报」一节。
// 全程整数运算：重量用克(g)、尺寸用毫米(mm)、金额用分(cents)、体积用立方毫米(mm³)；
// 体积重用「分子/分母」有理数比较，避免浮点漂移。

var LIMITS={
  MIN_ROWS:1, MAX_ROWS:8,
  MIN_QTY:1, MAX_QTY:9, MAX_UNITS:10,
  MIN_WEIGHT_G:10, MAX_WEIGHT_G:100000,   // 0.01–100 kg
  MIN_DIM_MM:10, MAX_DIM_MM:3000,         // 1–300 cm
  MIN_DIVISOR:1000, MAX_DIVISOR:20000,
  MIN_FIRST_G:100, MAX_FIRST_G:100000,
  MIN_PRICE_C:0, MAX_PRICE_C:1000000,     // 0–10000 元
  MIN_STEP_G:100, MAX_STEP_G:100000,
  MIN_MIN_G:0, MAX_MIN_G:100000,
  MIN_PARCELS:1, MAX_PARCELS:4,
  MIN_MERGE_PCT:100, MAX_MERGE_PCT:160,   // 合并体积系数 1.00–1.60
  ROUNDING_CHOICES:[100,500,1000],
  DIVISOR_PRESETS:[5000,6000,8000,12000],
  SHRINK_KEEP:[90,80,70]
};
var ROUNDING_LABELS={100:'0.1 kg',500:'0.5 kg',1000:'1 kg'};

// ── 基础工具 ────────────────────────────────────────────────
function ceilDiv(a,b){return Math.floor((a+b-1)/b);}   // a≥0、b>0 的整数

function err(msg){var e=new Error(msg);e.userMessage=msg;return e;}

function decToInt(v,mult,label){
  var s;
  if(typeof v==='number'){ if(!Number.isFinite(v))throw err(label+'需为数字'); s=String(v); }
  else s=(v===null||v===undefined)?'':String(v).trim();
  if(s==='')throw err(label+'不能为空');
  if(!/^\d+(\.\d+)?$/.test(s))throw err(label+'需为非负数字（不支持负号、千分位、科学计数法）');
  var multDigits=String(mult).length-1;
  var parts=s.split('.'),frac=parts[1]||'';
  if(frac.length>multDigits)throw err(label+'最多 '+multDigits+' 位小数');
  var f=frac.length<multDigits?frac+'0'.repeat(multDigits-frac.length):frac;
  var out=Number(parts[0])*mult+(multDigits?Number(f):0);
  if(!Number.isFinite(out))throw err(label+'超出可处理范围');
  return out;
}

function toIntStrict(v,label){
  if(typeof v==='number'){ if(!Number.isInteger(v))throw err(label+'需为整数'); return v; }
  var s=(v===null||v===undefined)?'':String(v).trim();
  if(s==='')throw err(label+'不能为空');
  if(!/^\d+$/.test(s))throw err(label+'需为非负整数');
  return Number(s);
}

// 非负有理数 num/den → 四舍五入到 decimals 位的十进制字符串
function rationalToFixed(num,den,decimals){
  var pow=Math.pow(10,decimals);
  var scaled=num*pow;
  var q=Math.floor(scaled/den);
  if((scaled-q*den)*2>=den)q+=1;
  if(decimals<=0)return String(q);
  var s=String(q);
  s='0'.repeat(Math.max(0,decimals+1-s.length))+s;
  return s.slice(0,s.length-decimals)+'.'+s.slice(s.length-decimals);
}
function rationalToNumber(num,den,decimals){return Number(rationalToFixed(num,den,decimals));}
function gToKgStr(g){return (g/1000).toFixed(2);}
function centsToYuan(c){return (c/100).toFixed(2);}

// ── 计费重与运费 ────────────────────────────────────────────
// 体积重(g) = V(mm³) ÷ 除数(cm³/kg)：mm³÷1000 得 cm³，再 ×1000 得 g，两次换算恰好约掉。
function isVolumeDominant(weightG,Vmm3,divisor){return Vmm3>weightG*divisor;}

// 计费重(g) = max( 按进位规则向上取整的 max(实重, 体积重), 最低计费重 )
function chargeableG(weightG,Vmm3,divisor,roundG,minG){
  var byVolume=isVolumeDominant(weightG,Vmm3,divisor),cg;
  if(byVolume)cg=ceilDiv(Vmm3,divisor*roundG)*roundG;
  else cg=Math.ceil(weightG/roundG)*roundG;
  if(cg<minG)cg=minG;
  return {chargeG:cg,byVolume:byVolume};
}

// 运费(分) = 首重价 + 续重步数 × 续重价；计费重不超过首重时只收首重价
function freightC(chargeG,firstG,firstC,stepG,stepC){
  if(chargeG<=firstG)return firstC;
  return firstC+ceilDiv(chargeG-firstG,stepG)*stepC;
}

// ── 合并外箱估算 ────────────────────────────────────────────
// 单件：直接用该件自身三边。
// 多件：以体积最大的那一件为基准箱，等比放大 s = ∛(系数 × 体积之和 ÷ 基准体积)，
//       三边各自四舍五入到毫米且不小于原边，再相乘得外箱体积。这是估算，不是装箱算法。
function boxDims(units,pct){
  if(!units.length)throw err('空的分块');
  if(units.length===1){var u=units[0];return {Lmm:u.Lmm,Wmm:u.Wmm,Hmm:u.Hmm,Vmm3:u.Vmm3,s:1,base:0};}
  var Vsum=0,maxV=-1,mi=0,i;
  for(i=0;i<units.length;i++){
    Vsum+=units[i].Vmm3;
    if(units[i].Vmm3>maxV){maxV=units[i].Vmm3;mi=i;}
  }
  var base=units[mi],s=Math.cbrt((pct/100)*Vsum/maxV);
  var Lm=Math.max(base.Lmm,Math.round(base.Lmm*s));
  var Wm=Math.max(base.Wmm,Math.round(base.Wmm*s));
  var Hm=Math.max(base.Hmm,Math.round(base.Hmm*s));
  return {Lmm:Lm,Wmm:Wm,Hmm:Hm,Vmm3:Lm*Wm*Hm,s:s,base:mi};
}

// ── 划分枚举（受限增长串，每个划分恰好枚举一次）─────────────
function forEachPartition(n,maxBlocks,fn){
  if(n<=0)return;
  if(n===1){fn([0]);return;}
  var a=new Array(n),top=Math.min(maxBlocks,n);
  a[0]=0;
  (function rec(i,maxUsed){
    if(i===n){fn(a.slice());return;}
    var up=Math.min(maxUsed+1,top-1);
    for(var v=0;v<=up;v++){a[i]=v;rec(i+1,v>maxUsed?v:maxUsed);}
  })(1,0);
}

// ── solve ───────────────────────────────────────────────────
function solve(input){
  input=input||{};
  var L=LIMITS;
  var raw=input.items;
  if(!Array.isArray(raw)||raw.length<L.MIN_ROWS)throw err('至少需要 1 行物品');
  if(raw.length>L.MAX_ROWS)throw err('最多 '+L.MAX_ROWS+' 行物品，当前 '+raw.length+' 行');

  // 1) 解析物品
  var rows=[],units=[],totalUnits=0,i,q;
  for(i=0;i<raw.length;i++){
    var r=raw[i]||{},no=i+1,pre='第'+no+'行';
    var name=String(r.name===null||r.name===undefined?'':r.name).trim();
    if(!name)name='物品'+no;
    if(name.length>24)name=name.slice(0,24);
    var weightG=decToInt(r.weightKg,1000,pre+'实重(kg)');
    if(weightG<L.MIN_WEIGHT_G||weightG>L.MAX_WEIGHT_G)
      throw err(pre+'实重需在 0.01–100 kg');
    var Lmm=decToInt(r.Lcm,10,pre+'长(cm)'),Wmm=decToInt(r.Wcm,10,pre+'宽(cm)'),Hmm=decToInt(r.Hcm,10,pre+'高(cm)');
    var dk=[['长',Lmm],['宽',Wmm],['高',Hmm]];
    for(var d=0;d<3;d++)if(dk[d][1]<L.MIN_DIM_MM||dk[d][1]>L.MAX_DIM_MM)
      throw err(pre+dk[d][0]+'需在 1–300 cm');
    var qty=toIntStrict((r.qty===undefined||r.qty===null||r.qty==='')?1:r.qty,pre+'件数');
    if(qty<L.MIN_QTY||qty>L.MAX_QTY)throw err(pre+'件数需在 1–'+L.MAX_QTY);
    var Vmm3=Lmm*Wmm*Hmm;
    rows.push({no:no,name:name,weightG:weightG,Lmm:Lmm,Wmm:Wmm,Hmm:Hmm,Vmm3:Vmm3,qty:qty});
    totalUnits+=qty;
  }
  if(totalUnits>L.MAX_UNITS)
    throw err('总件数 '+totalUnits+' 超过上限 '+L.MAX_UNITS+'（各行件数之和）；请减少行数或件数');
  rows.forEach(function(it){for(var n=0;n<it.qty;n++)units.push({
    row:it.no,name:it.name,weightG:it.weightG,Lmm:it.Lmm,Wmm:it.Wmm,Hmm:it.Hmm,Vmm3:it.Vmm3});});

  // 2) 解析报价表与参数
  var rate=input.rate||{};
  var firstG=decToInt(rate.firstKg,1000,'首重(kg)');
  if(firstG<L.MIN_FIRST_G||firstG>L.MAX_FIRST_G)throw err('首重需在 0.1–100 kg');
  var stepG=decToInt(rate.stepKg,1000,'续重步长(kg)');
  if(stepG<L.MIN_STEP_G||stepG>L.MAX_STEP_G)throw err('续重步长需在 0.1–100 kg');
  var firstC=decToInt(rate.firstPrice,100,'首重价(元)');
  if(firstC<L.MIN_PRICE_C||firstC>L.MAX_PRICE_C)throw err('首重价需在 0–10000 元');
  var stepC=decToInt(rate.stepPrice,100,'续重价(元)');
  if(stepC<L.MIN_PRICE_C||stepC>L.MAX_PRICE_C)throw err('续重价需在 0–10000 元');
  var divisor=toIntStrict(rate.divisor,'体积重除数');
  if(divisor<L.MIN_DIVISOR||divisor>L.MAX_DIVISOR)
    throw err('体积重除数需在 '+L.MIN_DIVISOR+'–'+L.MAX_DIVISOR+'（cm³/kg）');
  var roundG=decToInt(rate.roundingKg,1000,'进位规则(kg)');
  if(L.ROUNDING_CHOICES.indexOf(roundG)<0)throw err('进位规则只支持 0.1 / 0.5 / 1 kg');
  var minG=decToInt((rate.minKg===undefined||rate.minKg==='')?0:rate.minKg,1000,'最低计费重(kg)');
  if(minG<L.MIN_MIN_G||minG>L.MAX_MIN_G)throw err('最低计费重需在 0–100 kg');
  var maxParcels=toIntStrict((input.maxParcels===undefined||input.maxParcels==='')?3:input.maxParcels,'最多包裹数');
  if(maxParcels<L.MIN_PARCELS||maxParcels>L.MAX_PARCELS)
    throw err('最多包裹数需在 '+L.MIN_PARCELS+'–'+L.MAX_PARCELS);
  var mergePct=decToInt((input.mergeFactor===undefined||input.mergeFactor==='')?'1.00':input.mergeFactor,100,'合并体积系数');
  if(mergePct<L.MIN_MERGE_PCT||mergePct>L.MAX_MERGE_PCT)throw err('合并体积系数需在 1.00–1.60');

  var ov=input.mergeOverride||null,ovDims=null;
  if(ov&&ov.on){
    var oL=decToInt(ov.Lcm,10,'实测外箱长(cm)'),oW=decToInt(ov.Wcm,10,'实测外箱宽(cm)'),oH=decToInt(ov.Hcm,10,'实测外箱高(cm)');
    var okd=[[oL,'长'],[oW,'宽'],[oH,'高']];
    for(var k2=0;k2<3;k2++)if(okd[k2][0]<L.MIN_DIM_MM||okd[k2][0]>L.MAX_DIM_MM)
      throw err('实测外箱'+okd[k2][1]+'需在 1–300 cm');
    ovDims={Lmm:oL,Wmm:oW,Hmm:oH,Vmm3:oL*oW*oH,s:null,base:null,override:true};
  }

  // 3) 单个包裹的成本
  function blockOf(list,isAll){
    var weightG=0,Vsum=0,j;
    for(j=0;j<list.length;j++){weightG+=list[j].weightG;Vsum+=list[j].Vmm3;}
    var box=(list.length===1)?boxDims(list,mergePct)
      :((isAll&&ovDims)?ovDims:boxDims(list,mergePct));
    var ch=chargeableG(weightG,box.Vmm3,divisor,roundG,minG);
    var fr=freightC(ch.chargeG,firstG,firstC,stepG,stepC);
    var volKg=rationalToNumber(box.Vmm3,divisor*1000,3);
    return {
      count:list.length,
      names:list.map(function(u){return u.name;}),
      rows:list.map(function(u){return u.row;}),
      weightG:weightG,weightKg:weightG/1000,
      Lmm:box.Lmm,Wmm:box.Wmm,Hmm:box.Hmm,
      Lcm:box.Lmm/10,Wcm:box.Wmm/10,Hcm:box.Hmm/10,
      boxVmm3:box.Vmm3,boxVcm3:box.Vmm3/1000,scale:box.s,override:!!box.override,
      volWeightKg:volKg,volWeightRatio:weightG>0?rationalToNumber(box.Vmm3,divisor*weightG,2):0,
      chargeG:ch.chargeG,chargeKg:ch.chargeG/1000,
      byVolume:ch.byVolume,
      freightC:fr,freightYuan:fr/100
    };
  }

  // 4) 逐规格诊断（每件单独寄）
  var soloC=0;
  var rowOut=rows.map(function(it){
    var ch=chargeableG(it.weightG,it.Vmm3,divisor,roundG,minG);
    var fr=freightC(ch.chargeG,firstG,firstC,stepG,stepC);
    var chW=chargeableG(it.weightG,0,divisor,roundG,minG);
    var frW=freightC(chW.chargeG,firstG,firstC,stepG,stepC);
    var byVolume=ch.byVolume;
    var rawNum,rawDen;
    if(byVolume){rawNum=it.Vmm3;rawDen=divisor;}else{rawNum=it.weightG;rawDen=1;}
    var carryNum=ch.chargeG*rawDen-rawNum;
    soloC+=fr*it.qty;
    return {
      no:it.no,name:it.name,qty:it.qty,
      weightKg:it.weightG/1000,weightG:it.weightG,
      Lcm:it.Lmm/10,Wcm:it.Wmm/10,Hcm:it.Hmm/10,Vcm3:it.Vmm3/1000,
      volWeightKg:rationalToNumber(it.Vmm3,divisor*1000,3),
      volWeightRatio:rationalToNumber(it.Vmm3,divisor*it.weightG,2),
      byVolume:byVolume,
      dominant:byVolume?'体积重':((it.Vmm3===it.weightG*divisor)?'相等':'实重'),
      chargeKg:ch.chargeG/1000,chargeG:ch.chargeG,
      carryKg:rationalToFixed(carryNum,rawDen*1000,3),
      inflationPct:ch.chargeG>0?Math.round((ch.chargeG-it.weightG)*1000/ch.chargeG)/10:0,
      freightYuan:fr/100,freightC:fr,
      rowFreightYuan:fr*it.qty/100,rowFreightC:fr*it.qty,
      weightOnlyChargeKg:chW.chargeG/1000,
      weightOnlyFreightYuan:frW/100,
      overpayYuan:(fr-frW)*it.qty/100,overpayC:(fr-frW)*it.qty
    };
  });

  // 5) 枚举全部分块方案（每包由若干整件组成，块数 ≤ 最多包裹数）
  function cmpRgs(a,b){for(var z=0;z<a.length;z++)if(a[z]!==b[z])return a[z]-b[z];return 0;}
  var best=null,bestByK={},partCount=0;
  forEachPartition(units.length,maxParcels,function(a){
    partCount++;
    var total=0,blocks=[],b,j;
    for(b=0;b<maxParcels;b++){
      var list=[];
      for(j=0;j<a.length;j++)if(a[j]===b)list.push(units[j]);
      if(list.length){
        var blk=blockOf(list,list.length===units.length);
        total+=blk.freightC;blocks.push(blk);
      }
    }
    var kk=blocks.length,rec={k:kk,totalC:total,blocks:blocks,rgs:a.slice()};
    if(!best||total<best.totalC||(total===best.totalC&&(kk<best.k||(kk===best.k&&cmpRgs(a,best.rgs)<0))))best=rec;
    var cur=bestByK[kk];
    if(!cur||total<cur.totalC||(total===cur.totalC&&cmpRgs(a,cur.rgs)<0))bestByK[kk]=rec;
  });

  // 6) 方案对照
  var perK=Object.keys(bestByK).map(Number).sort(function(x,y){return x-y;}).map(function(k){return bestByK[k];});
  var singleAll=blockOf(units.slice(),true);
  var schemes=[];
  schemes.push({key:'best',label:'最优方案（'+best.k+' 个包裹）',k:best.k,totalC:best.totalC,blocks:best.blocks});
  perK.forEach(function(p){
    if(p.k===best.k)return;
    schemes.push({key:'k'+p.k,
      label:(p.k===units.length?'全部逐件单独寄（'+p.k+' 个包裹）':p.k+' 个包裹（该包数下最省）'),
      k:p.k,totalC:p.totalC,blocks:p.blocks});
  });
  if(units.length>maxParcels){
    schemes.push({key:'solo',label:'全部逐件单独寄（'+units.length+' 个包裹，超出最多包裹数，仅对照）',
      k:units.length,totalC:soloC,blocks:units.map(function(u){return blockOf([u],units.length===1);}),outOfLimit:true});
  }
  schemes.forEach(function(s){
    s.totalYuan=s.totalC/100;
    s.savingVsSoloC=soloC-s.totalC;
    s.savingVsSoloYuan=(soloC-s.totalC)/100;
    s.isBest=s.key==='best';
    s.outOfLimit=!!s.outOfLimit;
  });
  schemes.sort(function(a,b){return a.totalC-b.totalC||a.k-b.k;});
  var outOfLimitCheaper=schemes.some(function(s){return s.outOfLimit&&s.totalC<best.totalC;});

  // 7) 敏感性：指定除数/进位下的最优与逐件总价
  function bestFor(dv,rg){
    var b=null;
    forEachPartition(units.length,maxParcels,function(a){
      var total=0,k=0,bx,j;
      for(bx=0;bx<maxParcels;bx++){
        var list=[];
        for(j=0;j<a.length;j++)if(a[j]===bx)list.push(units[j]);
        if(list.length){
          k++;
          var w=0,V=0;
          for(j=0;j<list.length;j++){w+=list[j].weightG;V+=list[j].Vmm3;}
          var box=(list.length===1)?boxDims(list,mergePct)
            :((list.length===units.length&&ovDims)?ovDims:boxDims(list,mergePct));
          var ch=chargeableG(w,box.Vmm3,dv,rg,minG);
          total+=freightC(ch.chargeG,firstG,firstC,stepG,stepC);
        }
      }
      if(!b||total<b.totalC)b={totalC:total,k:k};
    });
    return b;
  }
  var roundSens=L.ROUNDING_CHOICES.map(function(rg){
    var t=bestFor(divisor,rg),solo=0,chargeSum=0;
    rowOut.forEach(function(r){
      var ch=chargeableG(r.weightG,r.Vcm3*1000,divisor,rg,minG);
      chargeSum+=ch.chargeG*r.qty;
      solo+=freightC(ch.chargeG,firstG,firstC,stepG,stepC)*r.qty;
    });
    return {roundG:rg,label:ROUNDING_LABELS[rg],bestYuan:t.totalC/100,bestC:t.totalC,bestK:t.k,
      soloYuan:solo/100,soloChargeKg:chargeSum/1000,current:rg===roundG};
  });
  var divSens=L.DIVISOR_PRESETS.map(function(dv){
    var t=bestFor(dv,roundG),solo=0,volSum=0;
    rowOut.forEach(function(r){
      var ch=chargeableG(r.weightG,r.Vcm3*1000,dv,roundG,minG);
      solo+=freightC(ch.chargeG,firstG,firstC,stepG,stepC)*r.qty;
      volSum+=Math.round(r.Vcm3*1000/dv)*r.qty;
    });
    return {divisor:dv,bestYuan:t.totalC/100,bestC:t.totalC,bestK:t.k,
      soloYuan:solo/100,soloVolWeightKg:volSum/1000,current:dv===divisor};
  });

  // 8) 体积压缩模拟（按钮会真的改输入并重算）
  var shrinkSim=L.SHRINK_KEEP.map(function(keepPct){
    var sc=Math.cbrt(keepPct/100);
    var su=[];
    rows.forEach(function(it){
      var Lm=Math.max(L.MIN_DIM_MM,Math.round(it.Lmm*sc));
      var Wm=Math.max(L.MIN_DIM_MM,Math.round(it.Wmm*sc));
      var Hm=Math.max(L.MIN_DIM_MM,Math.round(it.Hmm*sc));
      for(var n=0;n<it.qty;n++)su.push({row:it.no,name:it.name,weightG:it.weightG,Lmm:Lm,Wmm:Wm,Hmm:Hm,Vmm3:Lm*Wm*Hm});
    });
    var b=null;
    forEachPartition(su.length,maxParcels,function(a){
      var total=0,bx,j;
      for(bx=0;bx<maxParcels;bx++){
        var list=[];
        for(j=0;j<a.length;j++)if(a[j]===bx)list.push(su[j]);
        if(list.length){
          var w=0,V=0;
          for(j=0;j<list.length;j++){w+=list[j].weightG;V+=list[j].Vmm3;}
          var box=boxDims(list,mergePct);
          var ch=chargeableG(w,box.Vmm3,divisor,roundG,minG);
          total+=freightC(ch.chargeG,firstG,firstC,stepG,stepC);
        }
      }
      if(!b||total<b.totalC)b={totalC:total,k:0};
    });
    return {keepPct:keepPct,totalYuan:b.totalC/100,totalC:b.totalC,
      savingVsBestYuan:(best.totalC-b.totalC)/100,savingVsBestC:best.totalC-b.totalC,
      savingVsSoloYuan:(soloC-b.totalC)/100};
  });

  // 9) 建议
  var advice=[];
  var volRows=rowOut.filter(function(r){return r.byVolume;});
  var denseRows=rowOut.filter(function(r){return !r.byVolume;});
  if(volRows.length)advice.push({kind:'bulky',text:'有 '+volRows.length+' 个规格的计费重由体积重决定：'+
    volRows.map(function(r){return r.name+'（实重 '+r.weightKg.toFixed(2)+' kg，按 '+r.chargeKg.toFixed(2)+' kg 计费，抛重 '+r.volWeightRatio.toFixed(2)+' 倍）';}).join('；')+
    '。对它们压实、抽真空或换小箱，比减轻重量更有效。'});
  if(denseRows.length)advice.push({kind:'dense',text:'有 '+denseRows.length+' 个规格由实重决定计费重（'+
    denseRows.map(function(r){return r.name;}).join('、')+'）：压体积不改变这些规格的计费重，只能减重或减少件数。'});
  if(best.k===1){
    advice.push({kind:'merge',text:'本场景合并成 1 个包裹最省：'+centsToYuan(soloC)+' 元 → '+centsToYuan(best.totalC)+
      ' 元，省 '+centsToYuan(soloC-best.totalC)+' 元（'+(soloC>0?Math.round((soloC-best.totalC)*1000/soloC)/10:0)+'%）。'+
      '合并后这 1 个包裹按 '+singleAll.chargeKg.toFixed(2)+' kg 计费，但省下 '+(units.length-1)+' 次首重。'});
  }else if(best.k<units.length){
    advice.push({kind:'split',text:'本场景拆成 '+best.k+' 个包裹最省：'+centsToYuan(soloC)+' 元 → '+centsToYuan(best.totalC)+
      ' 元，省 '+centsToYuan(soloC-best.totalC)+' 元。全部合并成 1 个包裹要 '+centsToYuan(singleAll.freightC)+' 元，比最优方案'+
      (singleAll.freightC>best.totalC?'贵 ':'便宜 ')+centsToYuan(Math.abs(singleAll.freightC-best.totalC))+' 元。'});
  }else{
    advice.push({kind:'split',text:'本场景下每个规格各寄一个包裹就是最省的（'+centsToYuan(soloC)+' 元）：任何合并都更贵，因为合并带来的体积重涨幅超过了省下的首重。'});
  }
  var shrinkNote=shrinkSim[1];
  if(outOfLimitCheaper)
    advice.push({kind:'limit',text:'你限制了最多 '+maxParcels+' 个包裹，最优解是 '+centsToYuan(best.totalC)+' 元；如果每个规格单独寄（'+
      units.length+' 个包裹）只要 '+centsToYuan(soloC)+' 元，能再省 '+centsToYuan(best.totalC-soloC)+' 元。要不要为了少寄 '+
      (units.length-best.k)+' 个包裹多花这 '+centsToYuan(best.totalC-soloC)+' 元由你定；把「最多包裹数」调大即可看到不受限的最优解。'});
  if(volRows.length&&shrinkNote.savingVsBestC>0)
    advice.push({kind:'shrink',text:'若把所有规格的三边等比压到 80%（体积约 51%），最优方案可由 '+centsToYuan(best.totalC)+
      ' 元降到 '+centsToYuan(shrinkNote.totalC)+' 元，再省 '+centsToYuan(shrinkNote.savingVsBestC)+' 元。按下面的按钮可直接改输入重算。'});
  advice.push({kind:'estimate',text:(ovDims?'“全部合并”方案用你填的实测外箱 '+(ovDims.Lmm/10)+'×'+(ovDims.Wmm/10)+'×'+(ovDims.Hmm/10)+' cm 计算；其他方案仍用等比估算。':
    '合并外箱按「放大最大件」等比估算，系数 '+ (mergePct/100).toFixed(2) +'；这不是装箱算法，只保证体积等于系数×各件体积之和的近似（三边取整到毫米）。有实测外箱时请勾选并填入，结果会改用实测值。')});

  var warnings=[
    '全部金额、计费重与体积重都由本页同一套整数口径算出：重量按克、尺寸按毫米、金额按分，体积重用有理数比较，不做浮点近似。',
    '报价表、进位规则与体积重除数都是你填的假设值；默认样例的费率与物品均为虚构示例，不代表任何快递公司的实际报价。'
  ];
  if(units.length>1&&maxParcels<units.length)
    warnings.push('「全部逐件单独寄」需要 '+units.length+' 个包裹，超过最多包裹数 '+maxParcels+'，只作对照，不参与最优。');
  if(outOfLimitCheaper)
    warnings.push('少寄包裹是有代价的：若不受「最多 '+maxParcels+' 个包裹」限制，全部逐件单独寄只要 '+centsToYuan(soloC)+
      ' 元，比当前最优便宜 '+centsToYuan(best.totalC-soloC)+' 元。把「最多包裹数」调到 '+units.length+' 即可看到不受限的最优解。');

  return {
    ok:true,
    rows:rowOut,rowCount:rows.length,units:units.length,
    totalWeightKg:rows.reduce(function(s,r){return s+r.weightG*r.qty;},0)/1000,
    totalVolCm3:units.reduce(function(s,u){return s+u.Vmm3;},0)/1000,
    maxParcels:maxParcels,partitions:partCount,
    rate:{firstKg:firstG/1000,firstYuan:firstC/100,stepKg:stepG/1000,stepYuan:stepC/100,
      divisor:divisor,roundingKg:roundG/1000,roundingLabel:ROUNDING_LABELS[roundG],minKg:minG/1000},
    mergeFactor:mergePct/100,
    soloC:soloC,soloYuan:soloC/100,
    best:{k:best.k,totalC:best.totalC,totalYuan:best.totalC/100,
      savingVsSoloC:soloC-best.totalC,savingVsSoloYuan:(soloC-best.totalC)/100,
      pct:soloC>0?Math.round((soloC-best.totalC)*1000/soloC)/10:0,
      blocks:best.blocks},
    singleBox:{k:1,totalC:singleAll.freightC,totalYuan:singleAll.freightC/100,
      chargeKg:singleAll.chargeKg,volWeightKg:singleAll.volWeightKg,weightKg:singleAll.weightG/1000,
      Lcm:singleAll.Lmm/10,Wcm:singleAll.Wmm/10,Hcm:singleAll.Hmm/10,
      boxVcm3:singleAll.boxVmm3/1000,byVolume:singleAll.byVolume,
      scale:singleAll.scale,override:singleAll.override,
      savingVsSoloYuan:(soloC-singleAll.freightC)/100},
    schemes:schemes,
    roundSens:roundSens,divSens:divSens,shrinkSim:shrinkSim,
    advice:advice,warnings:warnings
  };
}

// ── 默认样例（虚构：搬家寄 5 个规格）────────────────────────
var sample={
  items:[
    {name:'书籍箱',weightKg:'22.0',Lcm:'45',Wcm:'35',Hcm:'30',qty:'1'},
    {name:'棉被袋（未压缩）',weightKg:'2.5',Lcm:'70',Wcm:'50',Hcm:'45',qty:'1'},
    {name:'衣物箱',weightKg:'5.0',Lcm:'70',Wcm:'50',Hcm:'45',qty:'1'},
    {name:'厨具箱',weightKg:'9.5',Lcm:'50',Wcm:'40',Hcm:'35',qty:'1'},
    {name:'显示器原箱',weightKg:'4.0',Lcm:'65',Wcm:'45',Hcm:'40',qty:'1'}
  ],
  rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'0.5',minKg:'1'},
  maxParcels:'3',mergeFactor:'1.10',
  mergeOverride:{on:false,Lcm:'',Wcm:'',Hcm:''}
};

var api={solve:solve,sample:sample,
  chargeableG:chargeableG,freightC:freightC,boxDims:boxDims,forEachPartition:forEachPartition,
  isVolumeDominant:isVolumeDominant,ceilDiv:ceilDiv,decToInt:decToInt,toIntStrict:toIntStrict,
  rationalToFixed:rationalToFixed,rationalToNumber:rationalToNumber,
  gToKgStr:gToKgStr,centsToYuan:centsToYuan,
  LIMITS:LIMITS,ROUNDING_LABELS:ROUNDING_LABELS};
g.AppCore=api;
if(typeof module!=='undefined')module.exports=api;
})(globalThis);
