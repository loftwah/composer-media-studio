import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { switchCreateProject } from '../public/voice-handoff.js';
import { PROJECT_TABS } from '../public/studio-route.js';

test('actual navigation keeps Create drafts in their project and fails closed on denied access', async () => {
 const source=readFileSync(new URL('../public/studio.js',import.meta.url),'utf8');
 const resume=source.slice(source.indexOf('function projectResumeKey()'),source.indexOf('async function boot()'));
 const load=source.slice(source.indexOf('async function loadProject('),source.indexOf('\nfunction defaultCreate()'));
 const start=source.indexOf('window.addEventListener("hashchange", async () => {');
 const handler=source.slice(start,source.indexOf('\n\nboot().catch(',start));
 let callback, route={view:'project',projectId:'a',tab:'create'};
 const visible=[]; const app={innerHTML:'',querySelector:()=>null};
 const stored=new Map();
 const localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const state={session:{projectResumeBinding:'fixture'},view:'project',projectId:'a',tab:'create',project:{id:'a'},create:{prompt:'A private'}};
 const context=vm.createContext({state,app,localStorage,projectCreateDrafts:new Map(),projectCreateDefaults:new Map([['a',{prompt:''}]]),switchCreateProject,window:{addEventListener:(name,fn)=>{if(name==='hashchange')callback=fn;}},parseHash:()=>route,api:async path=>{const id=path.split('/').at(-1);if(id==='denied')throw new Error('forbidden');return {project:{id},assets:[],generations:[],recipes:[],publications:[],compositions:[],budget:{}}},render:()=>visible.push(state.project?.id===state.projectId ? `${state.projectId}:${state.create.prompt}` : 'loading'),defaultCreate:()=>({prompt:''}),PROJECT_TABS,viewerReturn:null,viewerFocusKey:null,viewerClosing:false,rejectMalformedHash:()=>{},rejectUnknownTab:()=>{}});
 vm.runInContext(`let createProjectId='a'; ${resume}\n${load}\n${handler}`,context);
 route={view:'project',projectId:'b',tab:'create'};await callback();assert.equal(state.create.prompt,'');assert.deepEqual([...stored.values()],['b']);state.create.prompt='B private';
 route={view:'project',projectId:'a',tab:'create'};await callback();assert.equal(state.create.prompt,'A private');
 route={view:'project',projectId:'b',tab:'create'};await callback();assert.equal(state.create.prompt,'B private');
 route={view:'project',projectId:'denied',tab:'create'};await callback();assert.match(app.innerHTML,/Could not open this studio/);assert.doesNotMatch(app.innerHTML,/private/);assert.equal(visible.at(-1),'loading');assert.deepEqual([...stored.values()],['b']);
 route={view:'project',projectId:'b',tab:'create'};await callback();assert.equal(state.create.prompt,'B private');
});
