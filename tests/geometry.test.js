import test from "node:test";
import assert from "node:assert/strict";
import { availableDisplays, displayForBounds, fitInWorkArea, validBounds } from "../extension/src/core/geometry.js";
const displays=[{isPrimary:true,workArea:{left:0,top:0,width:1600,height:900}},{isPrimary:false,workArea:{left:-1280,top:0,width:1280,height:800}}];
test("validates persisted geometry",()=>{assert.equal(validBounds({left:-500,top:0,width:500,height:600}),true);assert.equal(validBounds({left:0,top:NaN,width:500,height:600}),false)});
test("negative-coordinate monitor",()=>{const b={left:-900,top:100,width:500,height:600};assert.equal(displayForBounds(b,displays),displays[1]);assert.deepEqual(fitInWorkArea(b,displays),b)});
test("missing monitor recovers",()=>assert.deepEqual(fitInWorkArea({left:4000,top:3000,width:500,height:600},displays),{left:1100,top:300,width:500,height:600}));
test("clamp dimensions",()=>{assert.deepEqual(fitInWorkArea({left:50,top:50,width:2000,height:1200},displays),{left:0,top:0,width:1600,height:900});assert.deepEqual(fitInWorkArea({left:10,top:20,width:1,height:1},displays),{left:10,top:20,width:360,height:300});assert.equal(availableDisplays([{isEnabled:false,workArea:displays[0].workArea}]).length,0)});
