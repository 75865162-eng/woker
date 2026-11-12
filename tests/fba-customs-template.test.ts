import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCustomsTemplateDefinition,renderTargetCustomsXml} from '../src/lib/fba-local/customs-template-rules';
import {parseCustomsProfile} from '../src/lib/fba-local/customs-profile-rules';
const mapping=(field:string)=>({field,element:field,type:'TEXT',required:true,maxLength:500});
const raw={root:'Declaration',namespace:'urn:target:customs:v1',itemsElement:'Items',itemElement:'Item',header:['number','destinationCountry','currency'].map(mapping),items:['description','hsCode','originCountry','quantity','unit','unitPrice','declaredValue'].map(mapping)};
const header={number:'D1',destinationCountry:'US',currency:'USD'},item={description:'A <&> widget',hsCode:'123456',originCountry:'CN',quantity:3,unit:'PCS',unitPrice:'1.123456',declaredValue:'3.370368'};
export const targetCustomsTemplateFixture=raw;
test('target XML mapping validates required fields, exact declared values and escapes text without claiming official validation',()=>{
 const definition=parseCustomsTemplateDefinition(raw),result=renderTargetCustomsXml(definition,header,[item]);assert.ok(result.xml.includes('A &lt;&amp;&gt; widget'));assert.equal(result.validation.officialSchemaValidated,false);assert.equal(result.validation.remoteSubmitted,false);
 assert.throws(()=>renderTargetCustomsXml(definition,header,[{...item,declaredValue:'3.370369'}]));assert.throws(()=>renderTargetCustomsXml(definition,header,[{...item,description:'\u0001'}]));
 assert.throws(()=>parseCustomsTemplateDefinition({...raw,root:'a:Root'}));assert.throws(()=>parseCustomsTemplateDefinition({...raw,root:'<!DOCTYPE X>'}));assert.throws(()=>parseCustomsTemplateDefinition({...raw,items:raw.items.slice(1)}));assert.throws(()=>parseCustomsTemplateDefinition({...raw,xslt:'external'}));
});
test('product settings are explicit versioned target declarations with no master mutation or implicit price calculation',()=>{
 const profile=parseCustomsProfile({productRecordId:'P',destinationCountry:'US',forwarder:'Target carrier',version:2,sourceReference:'Target product declaration v2',values:{description:'Widget',hsCode:'123456',originCountry:'CN',unit:'PCS',unitPrice:'1.123456',currency:'USD',priceBasis:'Target approved declared price',priceRate:'0.5'}});assert.equal(profile.values.unitPrice,'1.123456');assert.equal(profile.values.priceRate,'0.500000');assert.equal(profile.version,2);assert.throws(()=>parseCustomsProfile({...profile,values:{...profile.values,priceRate:'0'}}));
});
