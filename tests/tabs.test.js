import test from "node:test";
import assert from "node:assert/strict";
import { displayTitle, hostname, orderedTabs, safeSegments, manualMove, planAutomaticSort } from "../extension/src/core/tabs.js";
const tab = (id,index,title,url="https://example.com/",rest={}) => ({id,index,title,url,pinned:false,groupId:-1,...rest});
test("indices and duplicate ids",()=>{
 const a=orderedTabs([tab(8,1,"same"),tab(7,0,"same")]);assert.deepEqual(a.map(x=>x.id),[7,8]);
 assert.deepEqual(manualMove(a,8,7,"before"),{tabId:8,index:0});
});
test("manual move and boundaries",()=>{
 const a=[tab(1,0,"A"),tab(2,1,"B"),tab(3,2,"C"),tab(4,3,"D")];
 assert.deepEqual(manualMove(a,1,3,"after"),{tabId:1,index:2});
 assert.deepEqual(manualMove(a,4,2,"before"),{tabId:4,index:1});
 assert.equal(manualMove(a,1,2,"before"),null);
 assert.equal(manualMove(a,1,1,"before"),null);
 const b=[tab(1,0,"p","",{pinned:true}),tab(2,1,"a"),tab(3,2,"g1","",{groupId:42}),tab(4,3,"g2","",{groupId:42}),tab(5,4,"b")];
 assert.deepEqual(safeSegments(b).map(x=>x.tabs.map(t=>t.id)),[[1],[2],[3,4],[5]]);
 assert.equal(manualMove(b,2,3,"after"),null);
 assert.deepEqual(manualMove(b,4,3,"before"),{tabId:4,index:2});
 assert.equal(manualMove(b,5,2,"after"),null);
});
test("display fallback and URL",()=>{
 assert.equal(displayTitle(tab(1,0,"","edge://settings/")),"edge://settings/");
 assert.equal(displayTitle(tab(1,0,"","")),"未命名标签页");
 assert.equal(hostname("https://www.Example.com/a"),"example.com");
});
test("stable natural title sorting",()=>{
 const a=[tab(1,0,"Page 10"),tab(2,1,"Page 2"),tab(3,2,"Page 2"),tab(4,3,"edge","edge://settings")];
 const sorted=planAutomaticSort(a,"title","asc");
 assert.deepEqual(sorted.finalIds,[2,3,1,4]);
 assert.deepEqual(planAutomaticSort(a,"title","desc").finalIds,[1,2,3,4]);
 assert.equal(planAutomaticSort(a.map(t=>({...t,index:sorted.finalIds.indexOf(t.id)})),"title","asc").moves.length,0);
});
test("domain and URL sorting",()=>{
 const a=[tab(1,0,"Z","https://www.a.com/z"),tab(2,1,"A","https://a.com/b"),tab(3,2,"X","https://b.com/a")];
 assert.deepEqual(planAutomaticSort(a,"domain","asc").finalIds,[2,1,3]);
 assert.deepEqual(planAutomaticSort(a,"url","asc").finalIds,[2,3,1]);
});
test("pinned, groups, special pages",()=>{
 const a=[tab(1,0,"p","https://z.com",{pinned:true}),tab(2,1,"Z","https://z.com"),tab(3,2,"A","https://a.com"),tab(4,3,"groupZ","https://z.com",{groupId:5}),tab(5,4,"groupA","https://a.com",{groupId:5}),tab(6,5,"special","chrome://extensions"),tab(7,6,"C","https://c.com")];
 const plan=planAutomaticSort(a,"domain","asc");
 assert.deepEqual(plan.finalIds,[1,3,2,5,4,7,6]);
 assert.equal(plan.protectedBlocks,2);
 assert.throws(()=>planAutomaticSort(a,"bad","asc"));
});
