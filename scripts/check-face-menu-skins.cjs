// Selector/cascade checks against production CSS in a simulated DOM, not browser layout QA.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),postcss=require('postcss');
const {JSDOM}=require(process.env.JSDOM_PATH||path.join(__dirname,'../../test-runtime/node_modules/jsdom'));
const root=path.resolve(__dirname,'..');
function load(file){const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);return m.exports;}
const {scopeSessionCSS}=load('lib/css-scoper.ts'),{BUILTIN_CHAT_CSS_SCHEMES:skins}=load('lib/builtin-chat-css.ts'),{BUILTIN_KAKAO_PLUGIN_CODE:plugin,BUILTIN_KAKAO_PLUGIN_MANIFEST:manifest}=load('lib/builtin-chat-plugin.ts');
assert.equal(plugin,fs.readFileSync(path.join(root,'design/chat-kkt/common.js'),'utf8'),'embedded plugin matches editable source');assert.equal(manifest.version,'0.13.2');
const native=fs.readFileSync(path.join(root,'styles/chat.css'),'utf8');
const palette=plugin.match(/palette.textContent = `([\s\S]*?)`;/)[1];
const yellow='#f3ca52';let checks=0;
function specificity(selector){const s=selector.replace(/:where\([^)]*\)/g,'');const attrs=(s.match(/\[[^\]]*\]/g)||[]).length;const clean=s.replace(/\[[^\]]*\]/g,'');return (clean.match(/#[\w-]+/g)||[]).length*10000+((clean.match(/\.[\w-]+/g)||[]).length+attrs+(clean.match(/:(?!:)[\w-]+/g)||[]).length)*100+(clean.replace(/[.#:][\w-]+/g,'').match(/\b[a-z][\w-]*\b/g)||[]).length;}
function rules(css){const result=[];postcss.parse(css).walkRules(rule=>{if(!rule.selector.includes('chat-plus'))return;const declarations=rule.nodes.filter(n=>n.type==='decl'&&['color','stroke','-webkit-text-fill-color'].includes(n.prop));if(!declarations.length)return;let layered=false;for(let p=rule.parent;p;p=p.parent)if(p.type==='atrule'&&p.name==='layer')layered=true;for(const selector of postcss.list.comma(rule.selector))result.push({selector,declarations,layered});});return result;}
function value(node,property,all){let best=null;let order=0;for(const rule of all){order++;if(!node.matches(rule.selector))continue;for(const declaration of rule.declarations){if(declaration.prop!==property)continue;const score=[declaration.important?1:0,declaration.important?(rule.layered?1:0):(rule.layered?0:1),specificity(rule.selector),order];if(!best||score.some((v,i)=>v!==best.score[i]&&score.slice(0,i).every((x,j)=>x===best.score[j])&&v>best.score[i]))best={score,value:declaration.value.trim().toLowerCase()};}}return best?.value;}
const legacySkins=skins.map(skin=>{const css=postcss.parse(skin.css);css.walkRules(rule=>{if(rule.selector.includes('data-chat-mode="face-to-face"'))rule.remove();});return {...skin,name:skin.name+' previously selected CSS',css:css.toString()};});
for(const skin of [null,...skins,...legacySkins])for(const theme of ['light','dark'])for(const enabledPlugin of [false,true]){
 const name=(skin?.name||'native')+'/'+theme+'/plugin='+enabledPlugin;
 const dom=new JSDOM('<div class="chat-app"><div class="chat-room-wrapper" data-audit-room><div class="chat-input-bar" data-ui="input" data-ii-kkt-ready="true"><div class="chat-plus-menu"><div class="chat-plus-menu-item" data-chat-mode="face-to-face"><span class="chat-plus-icon-box"><svg></svg></span><span class="label">线上走线下</span></div></div></div></div></div>');
 const doc=dom.window.document;doc.querySelector('.chat-app').setAttribute('data-chat-theme',theme);
 const item=doc.querySelector('.chat-plus-menu-item'),svg=item.querySelector('svg'),label=item.querySelector('.label');
 const all=[...rules(native),...(skin?rules(scopeSessionCSS(skin.css,'[data-audit-room]')):[]),...(enabledPlugin?rules(palette):[])];
 item.setAttribute('data-active','');
 for(const [node,property] of [[svg,'color'],[svg,'stroke'],[label,'color'],[label,'-webkit-text-fill-color']]){assert.equal(value(node,property,all),yellow,name+' active '+property);checks++;}
 item.removeAttribute('data-active');
 for(const [node,property] of [[svg,'color'],[label,'color']]){assert.notEqual(value(node,property,all),yellow,name+' inactive '+property);checks++;}
 dom.window.close();
}
console.log(`PASS face menu: ${checks} CSS cascade checks across native/glass/flat, day/night and plugin on/off; embedded plugin source matches.`);
