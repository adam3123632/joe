import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePreferences,defaultPreferences,contentSignature} from '../chat-reader/preferences.ts';

test('reader preferences reject invalid values and bound audio settings',()=>{
  assert.deepEqual(validatePreferences(null),defaultPreferences());
  const value=validatePreferences({rate:99,volume:-2,autoCollapse:false,follow:'yes',voiceId:22,
    collapsed:{a:true,b:1},positions:{a:{signature:'8-fade',progress:.65},b:{signature:'x',progress:NaN},c:{signature:'x',progress:2}},
    selectedByConversation:{'/c/a':'answer',bad:43}});
  assert.equal(value.rate,2.5);assert.equal(value.volume,0);
  assert.equal(value.autoCollapse,false);assert.equal(value.follow,true);assert.equal(value.voiceId,null);
  assert.deepEqual(value.collapsed,{a:true});
  assert.deepEqual(value.positions,{a:{signature:'8-fade',progress:.65}});
  assert.deepEqual(value.selectedByConversation,{'/c/a':'answer'});
});

test('saved reader state is bounded and strips extra manuscript fields',()=>{
  const value=validatePreferences({text:'private manuscript',collapsed:Object.fromEntries(Array.from({length:400},(_,i)=>[String(i),true])),
    positions:{a:{signature:contentSignature('a private manuscript'),progress:.4,text:'private manuscript'}},
    selectedByConversation:JSON.parse('{"__proto__":"bad","/c/a":"reply"}')});
  assert.equal(Object.keys(value.collapsed).length,300);
  assert.equal(JSON.stringify(value).includes('private manuscript'),false);
  assert.deepEqual(value.selectedByConversation,{'/c/a':'reply'});
  assert.deepEqual(value.positions.a,{signature:contentSignature('a private manuscript'),progress:.4});
  assert.notEqual(contentSignature('first version'),contentSignature('next version'));
  assert.equal(contentSignature('first version'),contentSignature('first version'));
});
