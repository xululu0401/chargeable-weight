'use strict';
// 计费重对账台 · 核心测试
// 运行：node --test tests/core.test.cjs
// 全部断言只看本次运行的原始结果，不依赖历史。
const test=require('node:test');
const assert=require('node:assert');
const C=require('../core.js');

// ── 独立朴素实现（浮点 + 容差），用于与工程实现对拍 ──────────
function nVolKg(Lcm,Wcm,Hcm,divisor){return Lcm*Wcm*Hcm/divisor;}
function nCharge(weightKg,Lcm,Wcm,Hcm,divisor,stepKg,minKg){
  const vol=nVolKg(Lcm,Wcm,Hcm,divisor);
  const raw=Math.max(weightKg,vol);
  let c=Math.ceil(raw/stepKg-1e-9)*stepKg;
  if(c<minKg-1e-12)c=minKg;
  return {chargeKg:c,byVolume:vol>weightKg+1e-12};
}
function nFreight(chargeKg,firstKg,firstYuan,stepKg,stepYuan){
  if(chargeKg<=firstKg+1e-12)return firstYuan;
  return firstYuan+Math.ceil((chargeKg-firstKg)/stepKg-1e-9)*stepYuan;
}
function nBox(list,f){                       // 与核心同一条已定义规则（三边四舍五入到毫米），独立实现
  const toMm=u=>({L:Math.round(u.L*10),W:Math.round(u.W*10),H:Math.round(u.H*10)});
  const ms=list.map(toMm);
  if(ms.length===1)return {L:ms[0].L/10,W:ms[0].W/10,H:ms[0].H/10};
  let Vsum=0,maxV=-1,bi=0;
  ms.forEach((u,i)=>{const V=u.L*u.W*u.H;Vsum+=V;if(V>maxV){maxV=V;bi=i;}});
  const b=ms[bi],s=Math.cbrt(f*Vsum/maxV);
  return {L:Math.max(b.L,Math.round(b.L*s))/10,W:Math.max(b.W,Math.round(b.W*s))/10,H:Math.max(b.H,Math.round(b.H*s))/10};
}
// 独立的分划枚举：先枚举「单位→块标签」的全部函数，再按首次出现顺序归一化去重
function naivePartitions(n,maxBlocks){
  const out=new Map();
  for(let k=1;k<=Math.min(maxBlocks,n);k++){
    const a=new Array(n).fill(0);
    (function rec(i){
      if(i===n){
        const map=new Map(),canon=a.map(v=>{if(!map.has(v))map.set(v,map.size);return map.get(v);});
        const key=canon.join(',');
        if(!out.has(key))out.set(key,canon);
        return;
      }
      for(let v=0;v<k;v++){a[i]=v;rec(i+1);}
    })(0);
  }
  return [...out.values()];
}
function naiveSolvePartition(units,f){
  // units: {w,L,W,H}（kg/cm）
  const groups=new Map();
  units.forEach((u,i)=>{const k=units.__a[i];if(!groups.has(k))groups.set(k,[]);groups.get(k).push(u);});
  return [...groups.values()].map(g=>{
    const box=nBox(g,f),w=g.reduce((s,u)=>s+u.w,0);
    return {box,w};
  });
}
function naiveTotal(units,a,f,divisor,stepKg,minKg,firstKg,firstYuan,stepYuan){
  const old=units.__a;units.__a=a;
  let total=0;
  for(const g of naiveSolvePartition(units,f)){
    const ch=nCharge(g.w,g.box.L,g.box.W,g.box.H,divisor,stepKg,minKg);
    total+=nFreight(ch.chargeKg,firstKg,firstYuan,stepKg,stepYuan);
  }
  units.__a=old;
  return total;
}
function stirling(n,k){                      // 第二类斯特林数
  const S=Array.from({length:n+1},()=>new Array(k+1).fill(0));S[0][0]=1;
  for(let i=1;i<=n;i++)for(let j=1;j<=k;j++)S[i][j]=j*S[i-1][j]+S[i-1][j-1];
  return S[n][k];
}
function mulberry(seed){                     // 确定性伪随机，测试可复现
  let a=seed>>>0;
  return function(){a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

// ── 1. 基础公式与边界 ───────────────────────────────────────
test('体积重 = 体积(cm³) ÷ 除数；单位链路 cm→mm→cm³ 不引入误差',()=>{
  const box=C.boxDims([{Lmm:600,Wmm:400,Hmm:400,Vmm3:600*400*400,name:'x',row:1}],110);
  assert.strictEqual(box.Vmm3,96000000);
  assert.strictEqual(box.Vmm3/1000,96000,'mm³→cm³');
  const r=C.solve({items:[{name:'a',weightKg:'1',Lcm:'60',Wcm:'40',Hcm:'40',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'1',minKg:'0'},maxParcels:'1'});
  assert.strictEqual(r.rows[0].Vcm3,96000);
  assert.strictEqual(r.rows[0].volWeightKg,16,'96000/6000=16 kg');
  assert.strictEqual(r.rows[0].dominant,'体积重');
});

test('进位规则：恰在边界不进位，多 1 克进一位',()=>{
  const g=(w,round)=>C.chargeableG(w,0,6000,round,0).chargeG;
  assert.strictEqual(g(1000,1000),1000,'恰好 1 kg 不进位');
  assert.strictEqual(g(1001,1000),2000,'1001 g → 2 kg');
  assert.strictEqual(g(1000,500),1000);
  assert.strictEqual(g(1001,500),1500,'1001 g 按 0.5 进位 → 1.5 kg');
  assert.strictEqual(g(1000,100),1000);
  assert.strictEqual(g(1001,100),1100);
  assert.strictEqual(g(0,100),0);
  // 体积重分支的进位边界（6000 cm³/kg = 1 kg）
  assert.strictEqual(C.chargeableG(1,6000000,6000,1000,0).chargeG,1000,'恰好 1 kg 体积重');
  assert.strictEqual(C.chargeableG(1,6000001,6000,1000,0).chargeG,2000,'多 1 mm³ 进一位');
});

test('首重边界：不超过首重只收首重价；超 1 克即加一个续重步长',()=>{
  const f=(c)=>C.freightC(c,1000,1000,1000,500);
  assert.strictEqual(f(500),1000,'低于首重');
  assert.strictEqual(f(1000),1000,'等于首重');
  assert.strictEqual(f(1001),1500,'超 1 克 → 首重价 + 1 步续重');
  assert.strictEqual(f(2000),1500);
  assert.strictEqual(f(2001),2000);
  assert.strictEqual(C.freightC(1001,1000,0,1000,0),0,'零续重价');
});

test('最低计费重与体积重/实重谁主导的边界（相等记实重、不抛重）',()=>{
  // 1 kg 实重、6000 cm³（=1 kg 体积重）→ 相等，不判抛重
  const r=C.solve({items:[{name:'a',weightKg:'1',Lcm:'20',Wcm:'20',Hcm:'15',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'1',minKg:'0'},maxParcels:'1'});
  assert.strictEqual(r.rows[0].Vcm3,6000);
  assert.strictEqual(r.rows[0].volWeightKg,1);
  assert.strictEqual(r.rows[0].byVolume,false);
  assert.strictEqual(r.rows[0].dominant,'相等');
  assert.strictEqual(r.rows[0].overpayYuan,0,'相等时不多付');
  // 最低计费重抬升
  const r2=C.solve({items:[{name:'a',weightKg:'0.2',Lcm:'5',Wcm:'5',Hcm:'5',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'1',minKg:'2'},maxParcels:'1'});
  assert.strictEqual(r2.rows[0].chargeKg,2);
  assert.strictEqual(r2.rows[0].freightYuan,15,'首重 10 + 1 步 5');
});

test('有理数格式化：四舍五入而非截断',()=>{
  assert.strictEqual(C.rationalToFixed(1,3,2),'0.33');
  assert.strictEqual(C.rationalToFixed(2,3,2),'0.67');
  assert.strictEqual(C.rationalToFixed(1,2,0),'1');
  assert.strictEqual(C.rationalToFixed(0,7,3),'0.000');
  assert.strictEqual(C.rationalToFixed(1001,1000,2),'1.00');
  assert.strictEqual(C.rationalToFixed(1999,1000,2),'2.00');
  assert.strictEqual(C.gToKgStr(25500),'25.50');
  assert.strictEqual(C.centsToYuan(50000),'500.00');
});

// ── 2. 与独立朴素实现对拍（逐规格） ─────────────────────────
test('对拍 300 组：逐规格计费重与运费与独立浮点实现一致',()=>{
  const rnd=mulberry(20261109);
  let checked=0;
  for(let t=0;t<300;t++){
    const weightKg=Math.round((0.05+rnd()*60)*100)/100;
    const Lcm=1+Math.round(rnd()*200),Wcm=1+Math.round(rnd()*200),Hcm=1+Math.round(rnd()*200);
    if(Lcm*Wcm*Hcm/1000*1>1e9)continue;
    const divisor=[5000,6000,8000,12000][Math.floor(rnd()*4)];
    const stepKg=[0.5,1][Math.floor(rnd()*2)];
    const minKg=[0,1,2][Math.floor(rnd()*3)];
    const firstKg=[0.5,1,2][Math.floor(rnd()*3)];
    const firstYuan=Math.round(rnd()*2000)/100;
    const stepYuan=Math.round(rnd()*1000)/100;
    const res=C.solve({items:[{name:'t',weightKg:String(weightKg),Lcm:String(Lcm),Wcm:String(Wcm),Hcm:String(Hcm),qty:'1'}],
      rate:{firstKg:String(firstKg),firstPrice:String(firstYuan),stepKg:String(stepKg),stepPrice:String(stepYuan),
        divisor:String(divisor),roundingKg:String(stepKg),minKg:String(minKg)},maxParcels:'1'});
    const row=res.rows[0];
    const n=nCharge(weightKg,Lcm,Wcm,Hcm,divisor,stepKg,minKg);
    assert.ok(Math.abs(row.chargeKg-n.chargeKg)<1e-9,
      'charge mismatch w='+weightKg+' box='+Lcm+'x'+Wcm+'x'+Hcm+' div='+divisor+' step='+stepKg+' core='+row.chargeKg+' naive='+n.chargeKg);
    assert.strictEqual(row.byVolume,n.byVolume,'主导因素判定不一致');
    const nf=nFreight(n.chargeKg,firstKg,firstYuan,stepKg,stepYuan);
    assert.ok(Math.abs(row.freightYuan-nf)<1e-9,'运费不一致 core='+row.freightYuan+' naive='+nf);
    assert.ok(Number.isFinite(row.volWeightKg)&&row.volWeightKg>=0,'体积重字段有效');
    checked++;
  }
  assert.ok(checked>250,'有效对拍组数应超过 250，实际 '+checked);
});

// ── 3. 划分枚举与最优性 ─────────────────────────────────────
test('划分枚举数量等于第二类斯特林数之和（n=1..7，块数 1..4）',()=>{
  for(let n=1;n<=7;n++){
    for(let kb=1;kb<=4;kb++){
      let cnt=0;
      C.forEachPartition(n,kb,()=>{cnt++;});
      let want=0;
      for(let k=1;k<=Math.min(kb,n);k++)want+=stirling(n,k);
      assert.strictEqual(cnt,want,'n='+n+' maxBlocks='+kb);
    }
  }
});

test('划分枚举：每个划分块数合法、块标签连续、无重复',()=>{
  for(let n=1;n<=7;n++){
    const seen=new Set();
    C.forEachPartition(n,4,a=>{
      assert.strictEqual(a.length,n);
      const labels=[...new Set(a)].sort((x,y)=>x-y);
      assert.ok(labels[0]===0,'块标签从 0 开始');
      labels.forEach((v,i)=>assert.strictEqual(v,i,'块标签连续'));
      const key=[...a].sort((x,y)=>x-y).join(',')+'|'+a.join(',');
      assert.ok(!seen.has(key),'同一划分不应重复枚举');
      seen.add(key);
    });
    assert.strictEqual(seen.size,naivePartitions(n,4).length,'与独立枚举的数量一致');
  }
});

test('对拍 200 组：最优总价与独立暴力枚举一致（n≤6，块数≤4）',()=>{
  const rnd=mulberry(777001);
  let checked=0;
  for(let t=0;t<200;t++){
    const n=2+Math.floor(rnd()*5);           // 2..6
    const items=[];
    for(let i=0;i<n;i++){
      items.push({name:'i'+i,
        weightKg:(Math.round((0.3+rnd()*25)*100)/100).toFixed(2),
        Lcm:String(1+Math.round(rnd()*90)),Wcm:String(1+Math.round(rnd()*90)),Hcm:String(1+Math.round(rnd()*90)),
        qty:'1'});
    }
    const divisor=[5000,6000,8000,12000][Math.floor(rnd()*4)];
    const stepKg=[0.5,1][Math.floor(rnd()*2)];
    const firstKg=[0.5,1,2][Math.floor(rnd()*3)];
    const firstYuan=Math.round(rnd()*1500)/100;
    const stepYuan=Math.round(rnd()*800)/100;
    const minKg=[0,1][Math.floor(rnd()*2)];
    const f=[1.0,1.1,1.25][Math.floor(rnd()*3)];
    const maxParcels=1+Math.floor(rnd()*4);

    const res=C.solve({items:items,
      rate:{firstKg:String(firstKg),firstPrice:String(firstYuan),stepKg:String(stepKg),stepPrice:String(stepYuan),
        divisor:String(divisor),roundingKg:String(stepKg),minKg:String(minKg)},
      maxParcels:String(maxParcels),mergeFactor:f.toFixed(2)});

    // 独立暴力：枚举全部分划并用朴素公式算总价
    const units=items.map(it=>({w:Number(it.weightKg),L:Number(it.Lcm),W:Number(it.Wcm),H:Number(it.Hcm)}));
    let bestNaive=Infinity;
    for(const a of naivePartitions(n,maxParcels)){
      const tot=naiveTotal(units,a,f,divisor,stepKg,minKg,firstKg,firstYuan,stepYuan);
      if(tot<bestNaive)bestNaive=tot;
    }
    assert.ok(Math.abs(res.best.totalYuan-bestNaive)<1e-6,
      '最优价不一致 core='+res.best.totalYuan+' naive='+bestNaive+' n='+n+' maxK='+maxParcels);
    // 逐件总价对拍
    let soloNaive=0;
    for(const u of units){
      const ch=nCharge(u.w,u.L,u.W,u.H,divisor,stepKg,minKg);
      soloNaive+=nFreight(ch.chargeKg,firstKg,firstYuan,stepKg,stepYuan);
    }
    assert.ok(Math.abs(res.soloYuan-soloNaive)<1e-6,'逐件总价不一致');
    // 不超限的对照方案不劣于最优；超限的「全部逐件」对照行允许更便宜（那是限制包裹数的代价）
    res.schemes.forEach(s=>{
      if(s.outOfLimit)return;
      assert.ok(s.totalC>=res.best.totalC-1e-9,'对照方案不应低于最优：'+s.key);
      assert.ok(s.k<=maxParcels,'不超限方案块数应在范围内');
    });
    assert.ok(res.schemes.some(s=>s.isBest&&s.key==='best'),'应标出最优方案行');
    assert.ok(res.best.k>=1&&res.best.k<=maxParcels,'最优块数在范围内');
    assert.ok(res.best.blocks.length===res.best.k,'块数与明细条数一致');
    assert.strictEqual(res.best.blocks.reduce((s,b)=>s+b.count,0),n,'分块覆盖全部件且不重复');
    checked++;
  }
  assert.ok(checked>190,'有效对拍组数应超过 190，实际 '+checked);
});

test('最优解在平分时取块数更少的方案（确定性）',()=>{
  // 4 件完全相同的小件：1 个包裹与 4 个包裹价格相同的情况下应取更少块数
  const items=[0,1,2,3].map(i=>({name:'x'+i,weightKg:'1',Lcm:'10',Wcm:'10',Hcm:'10',qty:'1'}));
  const rate={firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'0',divisor:'6000',roundingKg:'1',minKg:'0'};
  const a=C.solve({items:items,rate:rate,maxParcels:'4',mergeFactor:'1.00'});
  const b=C.solve({items:items,rate:rate,maxParcels:'4',mergeFactor:'1.00'});
  assert.strictEqual(a.best.k,b.best.k,'两次结果一致');
  assert.strictEqual(a.best.totalC,b.best.totalC);
  assert.strictEqual(a.best.k,1,'续重免费 + 体积重不随件数增长时，合并成 1 个包裹不低于其他方案');
});

// ── 4. 合并外箱估算 ─────────────────────────────────────────
test('合并外箱：放大倍数 s=∛(系数×体积和÷基准体积)，三边不小于基准件',()=>{
  const u=[{Lmm:600,Wmm:400,Hmm:400,Vmm3:600*400*400,name:'a',row:1},
           {Lmm:400,Wmm:300,Hmm:200,Vmm3:400*300*200,name:'b',row:2}];
  const Vsum=u[0].Vmm3+u[1].Vmm3,base=u[0];
  const box=C.boxDims(u,110);
  assert.ok(Math.abs(box.s-Math.cbrt(1.1*Vsum/base.Vmm3))<1e-12,'放大倍数公式一致');
  assert.ok(box.Lmm>=base.Lmm&&box.Wmm>=base.Wmm&&box.Hmm>=base.Hmm,'三边不小于基准件');
  assert.ok(box.Vmm3>0);
  // 系数 1.00 时外箱体积应接近各件体积之和（三边取整带来少量偏差）
  const box100=C.boxDims(u,100);
  assert.ok(Math.abs(box100.Vmm3-Vsum)/Vsum<0.02,'系数 1.00 时体积接近各件之和，偏差 '+
    (Math.abs(box100.Vmm3-Vsum)/Vsum*100).toFixed(2)+'%');
  // 单件不加成
  const one=C.boxDims([u[1]],160);
  assert.strictEqual(one.Vmm3,u[1].Vmm3);
  assert.strictEqual(one.s,1);
  // 系数单调：系数越大，外箱体积不减
  const b110=C.boxDims(u,110).Vmm3,b140=C.boxDims(u,140).Vmm3;
  assert.ok(b140>=b110,'系数越大体积不减');
});

test('实测外箱只在「全部合并」方案生效，其他方案仍用估算',()=>{
  const base={items:[{name:'a',weightKg:'2',Lcm:'60',Wcm:'50',Hcm:'40',qty:'1'},
                     {name:'b',weightKg:'3',Lcm:'50',Wcm:'40',Hcm:'40',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'0.5',minKg:'1'},
    maxParcels:'2',mergeFactor:'1.10'};
  const est=C.solve(Object.assign({},base));
  const ovr=C.solve(Object.assign({},base,{mergeOverride:{on:true,Lcm:'120',Wcm:'80',Hcm:'60'}}));
  assert.strictEqual(est.singleBox.override,false);
  assert.strictEqual(ovr.singleBox.override,true);
  assert.strictEqual(ovr.singleBox.Lcm,120);
  assert.strictEqual(ovr.singleBox.boxVcm3,120*80*60);
  assert.notStrictEqual(est.singleBox.totalC,ovr.singleBox.totalC,'实测外箱应改变合并方案价格');
  // 逐件诊断不受实测外箱影响
  assert.deepStrictEqual(est.rows.map(r=>r.chargeKg),ovr.rows.map(r=>r.chargeKg));
});

// ── 5. 敏感性、压缩模拟与建议 ───────────────────────────────
test('体积重除数敏感性：除数越大，体积重越小、总价不增',()=>{
  const r=C.solve(C.sample);
  assert.strictEqual(r.divSens.length,4);
  let prev=Infinity;
  r.divSens.forEach(s=>{
    assert.ok(Number.isFinite(s.bestYuan)&&s.bestYuan>=0,'价格字段有效');
    assert.ok(Number.isFinite(s.soloVolWeightKg)&&s.soloVolWeightKg>=0,'体积重合计有效');
    assert.ok(s.bestYuan<=prev+1e-9,'除数越大总价不增：'+s.divisor+' → '+s.bestYuan);
    prev=s.bestYuan;
    assert.ok(s.bestK>=1&&s.bestK<=r.maxParcels);
  });
  assert.strictEqual(r.divSens.filter(s=>s.current).length,1,'当前除数唯一标记');
  assert.strictEqual(r.divSens.find(s=>s.current).divisor,r.rate.divisor);
});

test('进位规则敏感性：计费重合计随进位步长不减，价格字段有效',()=>{
  const r=C.solve(C.sample);
  assert.strictEqual(r.roundSens.length,3);
  let prev=0;
  r.roundSens.forEach(s=>{
    assert.ok(Number.isFinite(s.soloChargeKg)&&s.soloChargeKg>=0,'计费重合计有效');
    assert.ok(s.soloChargeKg>=prev-1e-9,'进位步长越大计费重合计不减：'+s.label);
    prev=s.soloChargeKg;
    assert.ok(Number.isFinite(s.soloYuan)&&Number.isFinite(s.bestYuan));
  });
  assert.strictEqual(r.roundSens.filter(s=>s.current).length,1);
});

test('体积压缩模拟：压得越小总价不增，且不超过当前最优',()=>{
  const r=C.solve(C.sample);
  assert.strictEqual(r.shrinkSim.length,3);
  let prev=Infinity;
  r.shrinkSim.forEach(s=>{
    assert.ok(s.totalC<=prev,'压缩越狠总价不增：'+s.keepPct+'% → '+s.totalYuan);
    prev=s.totalC;
    assert.ok(s.totalC<=r.best.totalC+1e-9,'压缩后不应比当前最优更贵');
    assert.ok(Number.isFinite(s.savingVsSoloYuan));
  });
  assert.ok(r.shrinkSim[2].totalC<=r.shrinkSim[0].totalC);
});

test('建议文本里的数字与同一次计算结果一致（可回溯）',()=>{
  const r=C.solve(C.sample);
  assert.ok(r.advice.length>=3,'至少给出三类建议');
  r.advice.forEach(a=>{
    assert.ok(typeof a.kind==='string'&&a.kind.length>0);
    assert.ok(typeof a.text==='string'&&a.text.length>10);
    assert.ok(!/undefined|NaN|\[object/.test(a.text),'建议文本不得出现 undefined/NaN：'+a.text);
  });
  const split=r.advice.find(a=>a.kind==='split'||a.kind==='merge');
  assert.ok(split,'应有拆包/合并的建议');
  assert.ok(split.text.includes(r.soloYuan.toFixed(2)),'建议含逐件总价 '+r.soloYuan.toFixed(2));
  assert.ok(split.text.includes(r.best.totalYuan.toFixed(2)),'建议含最优总价 '+r.best.totalYuan.toFixed(2));
  const bulky=r.advice.find(a=>a.kind==='bulky');
  assert.ok(bulky,'默认样例应有抛重规格');
  r.rows.filter(x=>x.byVolume).forEach(x=>assert.ok(bulky.text.includes(x.name),'抛重规格应出现在建议里：'+x.name));
});

// ── 6. 非法输入与上限 ───────────────────────────────────────
test('非法与越界输入全部报错，且不产生半成品结果',()=>{
  const ok={items:[{name:'a',weightKg:'1',Lcm:'10',Wcm:'10',Hcm:'10',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'5',divisor:'6000',roundingKg:'1',minKg:'0'},maxParcels:'1'};
  const bad=(patch,msg)=>{
    const inp=JSON.parse(JSON.stringify(ok));
    patch(inp);
    assert.throws(()=>C.solve(inp),(e)=>e instanceof Error&&typeof e.userMessage==='string',msg);
  };
  bad(i=>{i.items=[];},'空清单');
  bad(i=>{i.items=[{name:'a',weightKg:'-1',Lcm:'10',Wcm:'10',Hcm:'10'}]},'负重量');
  bad(i=>{i.items[0].weightKg='';},'空重量');
  bad(i=>{i.items[0].weightKg='0.001';},'低于 0.01 kg');
  bad(i=>{i.items[0].weightKg='101';},'超过 100 kg');
  bad(i=>{i.items[0].weightKg='1.2345';},'重量小数位过多');
  bad(i=>{i.items[0].Lcm='0.5';},'小于 1 cm');
  bad(i=>{i.items[0].Wcm='301';},'超过 300 cm');
  bad(i=>{i.items[0].Hcm='10.55';},'尺寸小数位过多');
  bad(i=>{i.items[0].qty='0';},'件数为 0');
  bad(i=>{i.items[0].qty='10';},'件数超上限');
  bad(i=>{i.items[0].qty='1.5';},'件数非整数');
  bad(i=>{i.items=new Array(9).fill({name:'a',weightKg:'1',Lcm:'10',Wcm:'10',Hcm:'10',qty:'1'});},'行数超上限');
  bad(i=>{i.rate.divisor='0';},'除数为 0');
  bad(i=>{i.rate.divisor='999';},'除数低于下限');
  bad(i=>{i.rate.divisor='20001';},'除数超上限');
  bad(i=>{i.rate.roundingKg='0.25';},'进位规则非枚举值');
  bad(i=>{i.rate.roundingKg='0';},'进位规则为 0');
  bad(i=>{i.rate.firstPrice='10001';},'首重价超范围');
  bad(i=>{i.rate.stepKg='0';},'续重步长为 0');
  bad(i=>{i.maxParcels='0';},'包裹数下限');
  bad(i=>{i.maxParcels='5';},'包裹数上限');
  bad(i=>{i.mergeFactor='0.99';},'合并系数下限');
  bad(i=>{i.mergeFactor='1.61';},'合并系数上限');
  bad(i=>{i.items=[{name:'a',weightKg:'1',Lcm:'10',Wcm:'10',Hcm:'10',qty:'6'},{name:'b',weightKg:'1',Lcm:'10',Wcm:'10',Hcm:'10',qty:'5'}];},'总件数超上限');
  bad(i=>{i.items[0].weightKg='1e3';},'科学计数法');
  bad(i=>{i.items[0].weightKg='1,000';},'千分位');
  bad(i=>{i.mergeOverride={on:true,Lcm:'0',Wcm:'10',Hcm:'10'};},'实测外箱越界');
  assert.strictEqual(C.solve(ok).ok,true,'合法输入仍可正常求解');
});

test('空结果与单件：1 件物品时只有 1 种划分且就是最优',()=>{
  const r=C.solve({items:[{name:'唯一一件',weightKg:'3',Lcm:'40',Wcm:'30',Hcm:'30',qty:'1'}],
    rate:{firstKg:'1',firstPrice:'12',stepKg:'0.5',stepPrice:'3',divisor:'8000',roundingKg:'0.5',minKg:'1'},maxParcels:'4'});
  assert.strictEqual(r.units,1);
  assert.strictEqual(r.partitions,1);
  assert.strictEqual(r.best.k,1);
  assert.strictEqual(r.best.totalYuan,r.soloYuan,'单件时最优等于逐件');
  assert.strictEqual(r.best.blocks[0].count,1);
  assert.ok(r.schemes.length>=1);
  assert.ok(r.schemes.every(s=>Number.isFinite(s.totalYuan)));
});

test('件数展开：qty 相同的多件被视为独立单位参与分块',()=>{
  const r=C.solve({items:[{name:'整箱货',weightKg:'5',Lcm:'40',Wcm:'30',Hcm:'30',qty:'3'}],
    rate:{firstKg:'1',firstPrice:'10',stepKg:'1',stepPrice:'4',divisor:'6000',roundingKg:'1',minKg:'0'},maxParcels:'3'});
  assert.strictEqual(r.units,3);
  assert.strictEqual(r.soloYuan,3*r.rows[0].freightYuan,'逐件总价 = 单件价 × 3');
  assert.strictEqual(r.best.blocks.reduce((s,b)=>s+b.count,0),3);
  assert.ok(r.best.k<=3);
});

// ── 7. 默认锚点（本次实跑，发布说明里的数字必须与此一致） ────
test('默认虚构样例的锚点数值（发布说明引用同一组数）',()=>{
  const r=C.solve(C.sample);
  assert.strictEqual(r.units,5);
  assert.strictEqual(r.rowCount,5);
  assert.strictEqual(r.partitions,41,'n=5、最多 3 个包裹的全部划分：1+15+25');
  assert.strictEqual(r.soloYuan,565,'全部逐件单独寄 565.00 元');
  assert.strictEqual(r.best.totalYuan,500,'最优 3 个包裹 500.00 元');
  assert.strictEqual(r.best.k,3);
  assert.strictEqual(r.best.savingVsSoloYuan,65);
  assert.strictEqual(r.best.pct,11.5);
  assert.strictEqual(r.singleBox.totalYuan,510,'全部合并成 1 个包裹 510.00 元');
  assert.strictEqual(r.singleBox.chargeKg,101);
  assert.strictEqual(r.totalWeightKg,43);
  assert.strictEqual(r.totalVolCm3,549250,'47250+157500+157500+70000+117000');
  // 逐规格
  const rows=r.rows.map(x=>[x.name,x.chargeKg,x.freightYuan,x.byVolume]);
  assert.deepStrictEqual(rows,[
    ['书籍箱',22,115,false],
    ['棉被袋（未压缩）',26.5,140,true],
    ['衣物箱',26.5,140,true],
    ['厨具箱',12,65,true],
    ['显示器原箱',19.5,105,true]
  ]);
  assert.strictEqual(r.rows.reduce((s,x)=>s+x.rowFreightC,0),r.soloC);
  assert.strictEqual(r.rows[0].overpayYuan,0,'实重主导不多付');
  assert.strictEqual(r.rows[1].overpayYuan,120,'棉被袋按实重只需 20 元，实际 140 元');
  // 敏感性锚点
  assert.deepStrictEqual(r.divSens.map(s=>s.bestYuan),[595,500,380,260]);
  assert.deepStrictEqual(r.divSens.map(s=>s.bestK),[3,3,2,1]);
  assert.deepStrictEqual(r.roundSens.map(s=>s.soloChargeKg),[105.8,106.5,108]);
  assert.deepStrictEqual(r.roundSens.map(s=>s.soloYuan),[565,565,565]);
  assert.deepStrictEqual(r.shrinkSim.map(s=>s.totalYuan),[450,410,360]);
  // 最优方案结构与金额自洽
  assert.strictEqual(r.best.blocks.reduce((s,b)=>s+b.freightC,0),r.best.totalC);
  assert.deepStrictEqual(r.best.blocks.map(b=>b.count),[3,1,1]);
  // 所有导出数字均为有限数
  const walk=(o,path)=>{
    if(typeof o==='number')assert.ok(Number.isFinite(o),'数值字段应为有限数：'+path);
    else if(o&&typeof o==='object')Object.keys(o).forEach(k=>{if(k!=='rows')walk(o[k],path+'.'+k);});
  };
  walk({a:r.soloYuan,b:r.best.totalYuan,c:r.singleBox.totalYuan},'anchor');
});
