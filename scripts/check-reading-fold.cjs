const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const file=path.resolve(__dirname,'../lib/reading-fold-geometry.ts'),m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {readingFoldGeometry,foldClipPath,shouldCompleteReadingFold}=m.exports,w=360,h=640;
const area=poly=>Math.abs(poly.reduce((a,p,i)=>{const q=poly[(i+1)%poly.length];return a+p.x*q.y-q.x*p.y;},0))/2;
for(const dir of [1,-1])for(const y of [0,h])for(let step=1;step<=200;step++){
 const c={x:dir===1?w:0,y},p={x:c.x-dir*step*w/100,y:c.y+(y===0?1:-1)*h*.23*Math.sin(Math.PI*step/200)};
 const g=readingFoldGeometry(w,h,c,p);assert(g);
 assert(Math.abs(area(g.front)+area(g.revealed)-w*h)<.01,'page partition');
 assert(Math.abs(area(g.flap)-area(g.revealed))<.01,'reflection preserves paper area');
 assert(!foldClipPath(g.front,w,h).includes('NaN'));
}
assert.equal(readingFoldGeometry(w,h,{x:w,y:h},{x:w,y:h}),null);
assert.equal(shouldCompleteReadingFold(20,w,0),false);assert.equal(shouldCompleteReadingFold(140,w,0),true);
assert.equal(shouldCompleteReadingFold(40,w,.6),true);assert.equal(shouldCompleteReadingFold(200,w,1,true),false);
console.log('PASS 089 reading fold: mirrored directions, top/bottom corners, area conservation, finite clips, commit and cancellation');
