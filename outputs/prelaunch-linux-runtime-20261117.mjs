import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const root=process.cwd(), tag=randomUUID().slice(0,8), name=`erp-linux-runtime-${tag}`, network=name;
const log=createWriteStream(path.join(root,'outputs/prelaunch-linux-runtime-20261117.log'),{flags:'a'});
const note=s=>{ console.log(s);log.write(s+'\n'); };
const run=(args,input)=>new Promise((resolve,reject)=>{ note('$ docker '+args.join(' '));const p=spawn('docker',args,{stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>{process.stdout.write(b);log.write(b)});p.stderr.on('data',b=>{process.stderr.write(b);log.write(b)});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(`docker exit ${c}`)));p.stdin.end(input); });
const sync=args=>execFileSync('docker',args,{encoding:'utf8'}).trim();
let id;
try {
 note(`开始 ${new Date().toISOString()} tag=${tag}；仅临时资源；不读取根.env，不挂载宿主node_modules`);
 note('源码HEAD='+execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
 for(const file of ['scripts/test-runtime-integration.mjs','scripts/next-run.mjs'])note(file+' sha256='+createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex'));
 note('Linux Node24.22.3 Bookworm不同于CI Node22.22.2 Ubuntu；internal网络经loopback代理，published-port reachability NOT VERIFIED。');
 id=sync(['create','--init','--name',name,'--label',`erp.linux.run=${tag}`,'--memory=8g','--cpus=4','--shm-size=1g','--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','-w','/work','erp-linux-runtime-playwright:20261117','node','-e',`const http=require('http'),net=require('net');http.createServer((req,res)=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>{try{const {port,service,ip}=JSON.parse(text);if(!Number.isInteger(port)||![5432,6379].includes(service)||!/^172\\.|^10\\.|^192\\.168\\./.test(ip))throw Error('invalid');const s=net.createServer(c=>{const remote=net.connect(service,ip);c.pipe(remote).pipe(c);c.on('error',()=>remote.destroy());remote.on('error',()=>c.destroy());});s.once('error',()=>{res.statusCode=500;res.end()});s.listen(port,'127.0.0.1',()=>res.end('ok'));}catch(e){res.statusCode=400;res.end(String(e))}})}).listen('/tmp/runtime-proxy-control.sock')`]);
 note(`外层容器ID=${id}`);await run(['start',id]);
 const files=[]; const extensions=new Set(['.ts','.tsx','.js','.mjs','.cjs','.json','.prisma','.sql','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2','.txt','.md','.toml','.sh']);
 function walk(dir){for(const e of readdirSync(path.join(root,dir),{withFileTypes:true})){if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','uploads','outputs'].includes(e.name))continue;const rel=dir+'/'+e.name;if(e.isDirectory())walk(rel);else if(extensions.has(path.extname(e.name)))files.push(rel)}}
 for(const dir of ['src','scripts','prisma','tests','public'])if(existsSync(path.join(root,dir)))walk(dir);
 for(const f of ['package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs','prisma.config.ts','middleware.ts'])if(existsSync(path.join(root,f)))files.push(f);
 note(`白名单源码文件=${files.length}；排除隐藏文件/.env/uploads/.local-pg/.workbuddy/宿主依赖`);
 const list=path.join(root,`outputs/prelaunch-linux-runtime-${tag}-files.txt`);writeFileSync(list,files.join('\n')+'\n');const tar=spawn('tar',['-cf','-','-T',list],{cwd:root,stdio:['ignore','pipe','pipe']});const extract=spawn('docker',['exec','-i',id,'tar','-xf','-','-C','/work'],{stdio:['pipe','pipe','pipe']});tar.stdout.pipe(extract.stdin);await Promise.all([new Promise((r,j)=>tar.on('exit',c=>c===0?r():j(Error('tar失败')))),new Promise((r,j)=>extract.on('exit',c=>c===0?r():j(Error('提取失败'))))]);
 await run(['exec',id,'node','-e',`const fs=require('fs');fs.copyFileSync('/tmp/schema-engine','/work/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x');fs.chmodSync('/work/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x',0o755);`]);
 const source=readFileSync(path.join(root,'scripts/test-runtime-integration.mjs'),'utf8');
 const replaceOnce=(s,from,to)=>{if(!s.includes(from)||s.indexOf(from)!==s.lastIndexOf(from))throw Error('临时适配锚点不唯一 '+from);return s.replace(from,to)};
 let adapted=replaceOnce(source,'chromium.launch({ headless: true })','chromium.launch({ headless: true, executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", args:["--no-sandbox"] })');
 for(const variable of ['context','operationsContext'])adapted=replaceOnce(adapted,`  const ${variable} = await browser.newContext();`,`  const ${variable} = await browser.newContext(); ${variable}.setDefaultNavigationTimeout(120000); ${variable}.setDefaultTimeout(60000);`);
 for(const [fixture,service,port] of [['pgFixture','5432','pgPort'],['redisFixture','6379','redisPort']])adapted=replaceOnce(adapted,`  assert.ok(docker(["port", ${fixture}.id, "${service}"]).endsWith(":" + ${port}));`,`  assert.deepEqual(verifyFixture(${fixture}).HostConfig.PortBindings["${service}/tcp"], [{ HostIp: "127.0.0.1", HostPort: ${port} }]);`);
 adapted=replaceOnce(adapted,'notCovered: [','notCovered: ["published-port reachability NOT VERIFIED: internal Docker network plus loopback proxy; HostConfig bindings checked instead", "CI environment equivalence NOT VERIFIED: Node24.22.3 Bookworm instead of Node22.22.2 Ubuntu",');
 adapted=replaceOnce(adapted,'  if (!process.exitCode) rmSync(directory, { recursive: true, force: true });','  console.log("取证目录保留 " + directory);');
 await run(['exec','-i',id,'sh','-c','cat > /work/scripts/test-runtime-linux-full.mjs'],adapted);
 note('宿主runner五表fixture原样执行；临时副本仅Chrome路径、冷编译超时、端口适配与取证保留。');
 await run(['network','create','--internal','--label',`erp.linux.run=${tag}`,network]);
 await run(['network','connect',network,id]);await run(['network','disconnect','bridge',id]);
 const shim=readFileSync(path.join(root,'outputs/prelaunch-linux-runtime-docker-shim-20261117.mjs'));
 await run(['exec','-i',id,'sh','-c','cat > /usr/local/bin/docker && chmod 755 /usr/local/bin/docker'],shim);
 await run(['exec','-e',`ERP_LINUX_FIXTURE_NETWORK=${network}`,'-e',`ERP_LINUX_FIXTURE_OUTER=${id}`,id,'node','scripts/test-runtime-linux-full.mjs']);
 note('完整Linux runtime runner退出码0；详见非空results，published-port reachability NOT VERIFIED。');
} catch(e){note('执行失败: '+e.stack);process.exitCode=1;}
finally {
 if(id){try{const inspect=JSON.parse(sync(['inspect',id]))[0];if(inspect.Id!==id||inspect.Config.Labels['erp.linux.run']!==tag)throw Error('外层资源身份不匹配');note('外层容器磁盘开销 '+sync(['inspect','--size','--format','{{.SizeRw}}',id]));await run(['cp',`${id}:/tmp`,path.join(root,`outputs/prelaunch-linux-runtime-${tag}-tmp`)]);await run(['rm','-f','-v',id]);}catch(e){note('清理/取证失败 '+e.message);process.exitCode=1;}}
 try{const n=JSON.parse(sync(['network','inspect',network]))[0];if(n.Labels['erp.linux.run']!==tag)throw Error('网络标签不匹配');await run(['network','rm',network]);}catch(e){note('网络检查/清理 '+e.message);process.exitCode=1;}
 note(`结束 ${new Date().toISOString()} exitCode=${process.exitCode??0}`);log.end();
}
