const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');let count=0;
function check(label,pass){assert(pass,label);count++;console.log('PASS '+label);}
function source(file){return ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function find(sf,predicate){let match;const visit=node=>{if(!match&&predicate(node))match=node;else ts.forEachChild(node,visit)};visit(sf);assert(match,'production source node not found');return match;}
function backHandlers(file,priority,env){const sf=source(file),call=find(sf,node=>ts.isCallExpression(node)&&node.expression.getText(sf)==='useAppBack'&&node.arguments[2]?.getText(sf)===String(priority));return [0,1].map(index=>vm.runInNewContext('('+call.arguments[index].getText(sf)+')',env));}
let selected='voice-line',artistCommentsOpen=true,voiceClosed=false,commentsClosed=false;
const [wvsBack,wvsActive]=backHandlers('components/weverse/weverse-live-view.tsx',30,{get selectedVoiceSegmentId(){return selected},get artistCommentsOpen(){return artistCommentsOpen},liveRootRef:{current:{getClientRects:()=>[{}]}},setSelectedVoiceSegmentId:value=>{selected=value;voiceClosed=true},setArtistCommentsOpen:value=>{artistCommentsOpen=value;commentsClosed=true}});
check('WVS voice sheet intercepts system back',wvsActive());wvsBack();
check('voice sheet closes before underlying comments',voiceClosed&&!commentsClosed&&artistCommentsOpen);wvsBack();
check('WVS comments close before exit menu',commentsClosed&&!artistCommentsOpen);
check('closed WVS sheets release system back',!wvsActive());
const [,hiddenWvsActive]=backHandlers('components/weverse/weverse-live-view.tsx',30,{selectedVoiceSegmentId:'voice-line',artistCommentsOpen:true,liveRootRef:{current:{getClientRects:()=>[]}}});
check('hidden WVS live cannot intercept another APP back',!hiddenWvsActive());

console.log(`Weverse navigation audit: ${count} checks passed.`);
