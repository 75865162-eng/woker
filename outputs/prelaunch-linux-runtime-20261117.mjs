import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const root=process.cwd(), tag=randomUUID().slice(0,8), name=`erp-linux-runtime-${tag}`, network=`erp-linux-runtime-${tag}`;
const log=createWriteStream(path.join(root,'outputs/prelaunch-linux-runtime-20261117.log'),{flags:'a'});
const note=s=>{ console.log(s);log.write(s+'\n'); };
const run=(args,input)=>new Promise((resolve,reject)=>{ note('$ docker '+args.join(' '));const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>{process.stdout.write(b);log.write(b)});p.stderr.on('data',b=>{process.stderr.write(b);log.write(b)});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(`docker exit ${c}`)));p.stdin.end(input); });
const sync=args=>execFileSync('docker',args,{encoding:'utf8'}).trim();
let id;
try {
 note(`开始 ${new Date().toISOString()} tag=${tag}；仅临时资源；不读取根.env，不挂载宿主node_modules`);
 id=sync(['create','--name',name,'--label',`erp.linux.run=${tag}`,'--memory=8g','--cpus=4','--shm-size=1g','--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','-w','/work','public.ecr.aws/docker/library/node:24-bookworm','node','-e',`const http=require('http'),net=require('net');http.createServer((req,res)=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>{try{const {port,service,ip}=JSON.parse(text);if(!Number.isInteger(port)||![5432,6379].includes(service)||!/^172\\.|^10\\.|^192\\.168\\./.test(ip))throw Error('invalid');const s=net.createServer(c=>{const remote=net.connect(service,ip);c.pipe(remote).pipe(c);c.on('error',()=>remote.destroy());remote.on('error',()=>c.destroy());});s.once('error',()=>{res.statusCode=500;res.end()});s.listen(port,'127.0.0.1',()=>res.end('ok'));}catch(e){res.statusCode=400;res.end(String(e))}})}).listen('/tmp/runtime-proxy-control.sock')`]);
 note(`外层容器ID=${id}`);await run(['start',id]);
 const files=[]; const extensions=new Set(['.ts','.tsx','.js','.mjs','.cjs','.json','.prisma','.sql','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.txt','.md','.toml','.sh']);
 function walk(dir){for(const e of readdirSync(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','uploads','outputs'].includes(e.name))continue;const rel=dir+'/'+e.name;if(e.isDirectory())walk(rel);else if(extensions.has(path.extname(e.name)))files.push(rel)}}
 for(const dir of ['src','scripts','prisma','tests','public'])if(existsSync(path.join(root,dir)))walk(dir);
 for(const f of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs','prisma.config.ts'])if(existsSync(path.join(root,f)))files.push(f);
 note(`白名单源码文件=${files.length}；明确排除所有隐藏文件/.env/uploads/.local-pg/.workbuddy/宿主依赖`);
 const list=path.join(root,`outputs/prelaunch-linux-runtime-${tag}-files.txt`);writeFileSync(list,files.join('\n')+'\n');const tar=spawn('tar',['-cf','-','-T',list],{cwd:root,stdio:['ignore','pipe','pipe']});const extract=spawn('docker',['exec','-i',id,'tar','-xf','-','-C','/work'],{stdio:['pipe','pipe','pipe']});tar.stdout.pipe(extract.stdin);await Promise.all([new Promise((r,j)=>tar.on('exit',c=>c===0?r():j(Error('tar失败')))),new Promise((r,j)=>extract.on('exit',c=>c===0?r():j(Error('提取失败'))))]);
 await run(['exec',id,'node','-e',`const fs=require('fs');const p='/work/package-lock.json';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('https://registry.npmjs.org/','https://registry.npmmirror.com/'));`]);
 note('仅临时副本lock下载源改为npmmirror，版本与integrity不变；宿主lock未改。');
 await run(['exec','-e','npm_config_fetch_timeout=120000','-e','npm_config_fetch_retries=1',id,'sh','-lc','apt-get update && apt-get install -y --no-install-recommends docker.io && npm ci --no-audit --no-fund && ERP_RUNTIME_MODE=production npx prisma generate && npx playwright install --with-deps chromium']);
 note('依赖与浏览器安装完成');
 await run(['network','create','--internal','--label',`erp.linux.run=${tag}`,network]);
 await run(['network','connect',network,id]);await run(['network','disconnect','bridge',id]);
 note('安装网络已断开，测试阶段仅本次internal网络。Docker socket仅用于原runner fixture命令。');
 // 后续安全适配器由同目录单独源文件注入，不改仓库runner。
 const shim=readFileSync(path.join(root,'outputs/prelaunch-linux-runtime-docker-shim-20261117.mjs'));
 await run(['exec','-i',id,'sh','-c','cat > /usr/local/bin/docker && chmod 755 /usr/local/bin/docker'],shim);
 await run(['exec','-e',`ERP_LINUX_FIXTURE_NETWORK=${network}`,'-e',`ERP_LINUX_FIXTURE_OUTER=${id}`,id,'node','scripts/test-runtime-integration.mjs']);
 note('完整runtime runner通过');
} catch(e){note('执行失败: '+e.stack);process.exitCode=1;}
finally {
 if(id){try{const inspect=JSON.parse(sync(['inspect',id]))[0];if(inspect.Id!==id||inspect.Config.Labels['erp.linux.run']!==tag)throw Error('外层资源身份不匹配');note('外层容器磁盘开销 '+sync(['inspect','--size','--format','{{.SizeRw}}',id]));await run(['cp',`${id}:/tmp`,path.join(root,`outputs/prelaunch-linux-runtime-${tag}-tmp`)]);await run(['rm','-f',id]);}catch(e){note('清理/取证失败 '+e.message)}}
 try{const n=JSON.parse(sync(['network','inspect',network]))[0];if(n.Labels['erp.linux.run']!==tag)throw Error('网络标签不匹配');await run(['network','rm',network]);}catch(e){note('网络检查/清理 '+e.message)}
 note(`结束 ${new Date().toISOString()}`);log.end();
}
