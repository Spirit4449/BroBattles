const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const babel=require('@babel/core');
const exportsForTest={};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/lib/mapEditorLink.js'),'utf8'),{babelrc:false,configFile:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,{exports:exportsForTest});
test('non-admin users have no editor element; admins get the chosen map and team variant',()=>{
 let created=0;const dom={createElement(){created++;return{setAttribute(k,v){this[k]=v;}};}};
 for(const user of [null,{}, {isAdmin:false},{isAdmin:'false'}])assert.equal(exportsForTest.createMapEditorLink({user,mapId:3,teamSize:2,document:dom}),null);
 assert.equal(created,0);
 const link=exportsForTest.createMapEditorLink({user:{isAdmin:true},mapId:3,mapLabel:'Serenity',teamSize:2,document:dom});
 assert.equal(link.href,'/map-editor?map=3&variant=2v2');assert.equal(link['aria-label'],'Edit Serenity');assert.equal(created,1);
});
