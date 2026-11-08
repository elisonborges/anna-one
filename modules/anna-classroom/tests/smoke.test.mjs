import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(join(root,path),'utf8');
const frontend=read('public/app.js');
const index=read('public/index.html');
const styles=read('public/styles.css');
const api=read('api/server.js');

test('frontend e API possuem sintaxe JavaScript válida',()=>{
 assert.doesNotThrow(()=>new Function(frontend));
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',join(root,'api/server.js')],{stdio:'pipe'}));
});

test('arquivos espelhados permanecem idênticos ao frontend do Worker',()=>{
 for(const name of ['index.html','app.js','styles.css']){
  assert.equal(read(name),read('public/'+name),name);
 }
});

test('o layout aprovado e os campos do login permanecem presentes',()=>{
 for(const id of ['auth-gate','classroom-login-form','classroom-email','classroom-password','classroom-signout','module-cards']){
  assert.match(index,new RegExp('id="'+id+'"'));
 }
 assert.match(styles,/#classroom-app \.sidebar \.brand img/);
 assert.match(styles,/#classroom-app\.layout/);
});

test('API exige JWT e permissão institucional antes das operações',()=>{
 assert.match(api,/jwtVerify\(match\[1\],jwks/);
 assert.match(api,/await permission\(client,userId,institutionId\)/);
 assert.match(api,/anna_classroom\.can_manage_institution/);
 assert.match(api,/X-Frame-Options/);
 for(const route of ['/v1/access','/v1/classes','/v1/students','/v1/enrollments','/v1/lessons','/v1/assignments','/v1/submissions','/v1/overview']){
  assert.ok(api.includes(route),route);
 }
});

test('busca nas listas ignora acentos e letras maiúsculas',()=>{
 const match=frontend.match(/ const normalized=text=>(.*?);\n const entries=/s);
 assert.ok(match,'normalizador deve existir na listagem');
 const normalized=new Function('return (text)=>'+match[1])();
 assert.equal(normalized('João Ávila'),normalized('JOAO AVILA'));
});

test('exportação CSV impede fórmulas e escapa aspas',()=>{
 const begin=frontend.indexOf(' const csvCell=value=>{');
 const end=frontend.indexOf(' csv.addEventListener(',begin);
 assert.ok(begin>=0&&end>begin,'proteção CSV deve existir');
 const csvCell=new Function(frontend.slice(begin,end)+' return csvCell;')();
 assert.equal(csvCell('=1+1'),'"\'=1+1"');
 assert.equal(csvCell('+SUM(1)'),'"\'+SUM(1)"');
 assert.equal(csvCell('Nome "Teste"'),'"Nome ""Teste"""');
});
