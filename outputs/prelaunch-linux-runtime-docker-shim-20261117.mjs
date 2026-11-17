#!/usr/local/bin/node
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import http from 'node:http';
const args=process.argv.slice(2), real=a=>execFileSync('/usr/bin/docker',a,{env:{...process.env,DOCKER_API_VERSION:'1.44'},stdio:[a[0]==='exec'&&a[1]==='-i'?'pipe':'ignore','pipe','pipe'],maxBuffer:32*1024*1024,input:a[0]==='exec'&&a[1]==='-i'?readFileSync(0):undefined});
const netfile='/tmp/runtime-fixture-network';if(process.env.ERP_LINUX_FIXTURE_NETWORK)writeFileSync(netfile,process.env.ERP_LINUX_FIXTURE_NETWORK);else if(existsSync(netfile))process.env.ERP_LINUX_FIXTURE_NETWORK=readFileSync(netfile,'utf8');
const file='/tmp/runtime-docker-allowlist.json', state=existsSync(file)?JSON.parse(readFileSync(file)):[];
function verified(target){const saved=state.find(v=>v.id===target||v.name===target);if(!saved)throw Error('禁止非本次资源 '+target);const obj=JSON.parse(real(['inspect',saved.id]))[0];if(obj.Id!==saved.id||obj.Name!=='/'+saved.name||obj.Config.Labels['codex.task']!=='erp-runtime-fixture'||obj.Config.Labels['erp.fixture.run']!==saved.tag||obj.HostConfig.NetworkMode!==process.env.ERP_LINUX_FIXTURE_NETWORK)throw Error('fixture身份或网络不符');return saved;}
try{
 if(args[0]==='image'&&args[1]==='inspect'&&args.length===3&&['postgres:16-alpine','redis:7'].includes(args[2]))process.stdout.write(real(args));
 else if(args[0]==='run'){
  const name=args[args.indexOf('--name')+1], labels=args.flatMap((v,i)=>v==='--label'?[args[i+1]]:[]),tag=labels.find(v=>v.startsWith('erp.fixture.run='))?.split('=')[1];
  if(!/^[a-f0-9]{8}$/.test(tag??'')||!new RegExp('^erp-runtime-(pg|redis)-'+tag+'$').test(name)||!labels.includes('codex.task=erp-runtime-fixture')||args.some(v=>['--mount','-v','--volume','--privileged','--network','--net'].includes(v)))throw Error('禁止非fixture run');
  const image=args.includes('postgres:16-alpine')?'postgres:16-alpine':args.includes('redis:7')?'redis:7':null;if(!image)throw Error('非fixture镜像');
  const binding=args[args.indexOf('-p')+1],match=/^127\.0\.0\.1:(\d+):(5432|6379)$/.exec(binding);if(!match)throw Error('非loopback绑定');
  const id=real(['run','--network',process.env.ERP_LINUX_FIXTURE_NETWORK,...args.slice(1)]).toString().trim();state.push({id,name,tag,port:Number(match[1]),service:Number(match[2])});writeFileSync(file,JSON.stringify(state));
  const info=JSON.parse(real(['inspect',id]))[0],ip=info.NetworkSettings.Networks[process.env.ERP_LINUX_FIXTURE_NETWORK].IPAddress;
  await new Promise((resolve,reject)=>{const req=http.request({socketPath:'/tmp/runtime-proxy-control.sock',path:'/',method:'POST'},res=>{res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(Error('代理失败')))});req.on('error',reject);req.end(JSON.stringify({port:Number(match[1]),service:Number(match[2]),ip}));});
  process.stdout.write(id+'\n');
 }else if(args[0]==='inspect'&&args.length===2){verified(args[1]);process.stdout.write(real(args));}
 else if(args[0]==='port'&&args.length===3){verified(args[1]);process.stdout.write(real(args));}
 else if(['stop','start','restart'].includes(args[0])&&args.length===2){verified(args[1]);process.stdout.write(real(args));}
 else if(args[0]==='rm'&&args[1]==='-f'&&args.length===3){verified(args[2]);process.stdout.write(real(args));}
 else if(args[0]==='exec'){
 const offset=args[1]==='-i'?2:1;const fixture=verified(args[offset]);const cmd=args.slice(offset+1);const allowed=(cmd[0]==='redis-cli'&&['PING','FLUSHALL'].includes(cmd[1])&&fixture.service===6379)||(['pg_dump','pg_restore'].includes(cmd[0])&&fixture.service===5432);if(!allowed)throw Error('禁止fixture以外exec');process.stdout.write(real(args));
 }else throw Error('未授权Docker命令 '+args.join(' '));
}catch(e){process.stderr.write(String(e.stack)+'\n'+(e.stderr?.toString()??''));process.exit(1)}
