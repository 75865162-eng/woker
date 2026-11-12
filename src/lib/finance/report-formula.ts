import {WmsError} from '@/lib/wms/contracts';
import {amountUnits} from './open-item-rules';
type Token={kind:'number'|'ref'|'symbol';value:string};
function tokenize(formula:string):Token[]{
 if(!formula.trim()||formula.length>500)throw new WmsError('报表公式须为 1–500 字符。',400);
 const tokens:Token[]=[];let index=0;
 while(index<formula.length){const rest=formula.slice(index);if(/^\s/.test(rest)){index++;continue;}const reference=/^\[([A-Za-z0-9_.-]{1,40})\]/.exec(rest),number=/^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?/.exec(rest);
  if(reference){tokens.push({kind:'ref',value:reference[1]});index+=reference[0].length;}
  else if(number){tokens.push({kind:'number',value:number[0]});index+=number[0].length;}
  else if('+-*/()'.includes(rest[0])){tokens.push({kind:'symbol',value:rest[0]});index++;}
  else throw new WmsError('公式只允许十进制常量、[行编码]、四则运算和括号。',400);
  if(tokens.length>200)throw new WmsError('报表公式过于复杂。',400);
 }return tokens;
}
export function reportFormulaReferences(formula:string){return [...new Set(tokenize(formula).filter(token=>token.kind==='ref').map(token=>token.value))];}
function rounded(numerator:bigint,denominator:bigint){if(!denominator)throw new WmsError('报表公式除数为零。',422);const negative=(numerator<BigInt(0))!==(denominator<BigInt(0)),a=numerator<BigInt(0)?-numerator:numerator,b=denominator<BigInt(0)?-denominator:denominator;const value=(a+b/BigInt(2))/b;return negative?-value:value;}
export function evaluateReportFormula(formula:string,resolve:(code:string)=>bigint,validateOnly=false){
 const tokens=tokenize(formula),scale=BigInt(1000000);let index=0;
 function checked(value:bigint){if((value<BigInt(0)?-value:value)>BigInt('999999999999999999999999999999'))throw new WmsError('报表公式金额超出支持范围。',422);return value;}
 function atom(depth:number):bigint{
  if(depth>20)throw new WmsError('公式括号或引用层级过深。',400);const token=tokens[index++];if(!token)throw new WmsError('报表公式不完整。',400);
  if(token.kind==='number')return amountUnits(token.value);if(token.kind==='ref')return resolve(token.value);
  if(token.value==='+'||token.value==='-'){const value=atom(depth+1);return token.value==='-'?-value:value;}
  if(token.value==='('){const value=expression(depth+1);if(tokens[index++]?.value!==')')throw new WmsError('公式括号不匹配。',400);return value;}
  throw new WmsError('报表公式表达式无效。',400);
 }
 function product(depth:number):bigint{let value=atom(depth);while(tokens[index]?.value==='*'||tokens[index]?.value==='/'){const operator=tokens[index++].value,right=atom(depth);value=checked(operator==='*'?rounded(value*right,scale):rounded(value*scale,validateOnly&&right===BigInt(0)?scale:right));}return value;}
 function expression(depth:number):bigint{let value=product(depth);while(tokens[index]?.value==='+'||tokens[index]?.value==='-'){const operator=tokens[index++].value,right=product(depth);value=checked(operator==='+'?value+right:value-right);}return value;}
 const value=expression(0);if(index!==tokens.length)throw new WmsError('报表公式包含多余表达式。',400);return checked(value);
}

export function validateReportFormula(formula:string){evaluateReportFormula(formula,()=>BigInt(0),true);}
