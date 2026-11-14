import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker.mjs";
import { createSession } from "../src/lib/auth.mjs";
import { publishCandidate } from "../src/lib/publication-policy.mjs";
import { setup, addAsset } from "./harness.mjs";

async function generated(env, project, suffix, source = "generated", created = 1) {
  const asset = await addAsset(env, project, { id:`asset_${suffix}`, kind:"image", source });
  await env.DB.prepare(`INSERT INTO generations(id,project_id,client_request_id,kind,recipe_id,provider,model,request_json,status,output_asset_id,cost_estimate_micro,cost_reserved_micro,created_at,updated_at)
    VALUES(?1,?2,?3,'image','recipe','test','studio-print','{"prompt":"private prompt","referenceAssetId":null,"parentAssetId":null,"maskAssetId":null}','saved',?4,0,0,?5,?5)`).bind(`gen_${suffix}`,project.id,`req_${suffix}`,asset.id,created).run();
  await env.DB.prepare("UPDATE assets SET generation_id=?2,caption='private caption' WHERE id=?1").bind(asset.id,`gen_${suffix}`).run();
  return asset;
}

test("first-party policy requires installation and project opt-in, protects withdrawal and reuses URLs", async () => {
  const { env, project } = await setup();
  const cookie = "studio_session=" + await createSession(env);
  const request = (path, method = "GET", data, auth = true) => worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/${path}`, { method, headers:{ ...(auth ? { cookie } : {}), ...(data ? { "content-type":"application/json", origin:"https://studio.test" } : {}) }, ...(data ? { body:JSON.stringify(data) } : {}) }), env);
  const a = await generated(env,project,"a");
  const variant = await generated(env,project,"variant","variant");
  const assembled = await generated(env,project,"assembled","assembled");
  const withdrawn = await generated(env,project,"withdrawn");
  const hidden = await generated(env,project,"hidden");
  const existing = await generated(env,project,"existing");
  const upload = await addAsset(env,project,{id:"asset_upload",kind:"image",source:"upload"});
  for (const [asset, suffix, revoke, hide] of [[withdrawn,"withdrawn",1,0],[hidden,"hidden",null,1],[existing,"existing",null,0]]) await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at,revoked_at,hidden) VALUES(?1,?2,?3,?4,'Existing','',1,1,?5,?6)").bind(`pub_${suffix}`,project.id,asset.id,`slug-${suffix}`,revoke,hide).run();
  assert.equal((await request("publication-inventory","GET",undefined,false)).status,401);
  assert.equal((await request("publication-policy","PUT",{enabled:true,rightsConfirmed:true})).status,403);
  env.FIRST_PARTY_PUBLICATION_PROJECTS = project.id;
  assert.equal((await request("publication-policy","PUT",{enabled:true})).status,400);
  const inv = await (await request("publication-inventory")).json();
  assert.deepEqual(Object.fromEntries(inv.items.map(x=>[x.id,x.status])), {asset_a:"candidate",asset_assembled:"attribution_review_required",asset_existing:"existing",asset_hidden:"hidden",asset_upload:"ineligible",asset_variant:"attribution_review_required",asset_withdrawn:"withdrawn"});
  assert.equal((await request("publication-policy","PUT",{enabled:true,rightsConfirmed:true})).status,200);
  const assetIds = [a.id,variant.id,assembled.id,withdrawn.id,hidden.id,existing.id,upload.id];
  assert.equal((await request("publication-reconcile","POST",{assetIds,confirm:true})).status,400);
  const payload={assetIds,confirm:true,rightsConfirmed:true};
  const results=(await (await request("publication-reconcile","POST",payload)).json()).results;
  assert.deepEqual(results.map(x=>x.result),["created","attribution_review_required","attribution_review_required","skipped","skipped","existing","skipped"]);
  const existingAfter=await env.DB.prepare("SELECT slug,listed FROM publications WHERE id='pub_existing'").first();
  assert.equal(existingAfter.slug,"slug-existing"); assert.equal(existingAfter.listed,1);
  const newPublication=await env.DB.prepare("SELECT title,description FROM publications WHERE asset_id=?1").bind(a.id).first();
  assert.equal(newPublication.title,"Generated image"); assert.equal(newPublication.description,"");
  await request("publication-reconcile","POST",payload);
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE asset_id=?1").bind(a.id).first(); assert.equal(count.n,1);
  await env.DB.prepare("UPDATE publications SET revoked_at=1 WHERE asset_id=?1").bind(a.id).run();
  await request("publication-reconcile","POST",payload);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE asset_id=?1").bind(a.id).first()).n,1);
  assert.equal(await publishCandidate(env,project.id,a.id,{automatic:true}),"skipped");
  assert.equal((await request("publication-policy","PUT",{enabled:false})).status,200);
  assert.equal((await request("publication-reconcile","POST",payload)).status,403);
});

test("automatic publication only accepts work started after project opt-in", async () => {
  const {env,project}=await setup(); env.FIRST_PARTY_PUBLICATION_PROJECTS=project.id;
  const cookie="studio_session="+await createSession(env);
  await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/publication-policy`,{method:"PUT",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({enabled:true,rightsConfirmed:true})}),env);
  const old=await generated(env,project,"old","generated",1);
  const fresh=await generated(env,project,"fresh","generated",Date.now()+1);
  assert.equal(await publishCandidate(env,project.id,old.id,{automatic:true}),"skipped");
  assert.equal(await publishCandidate(env,project.id,fresh.id,{automatic:true}),"created");
  assert.equal(await publishCandidate(env,project.id,fresh.id,{automatic:true}),"existing");
  await env.DB.prepare("UPDATE publications SET listed=0 WHERE asset_id=?1").bind(fresh.id).run();
  assert.equal(await publishCandidate(env,project.id,fresh.id,{automatic:true}),"existing");
  assert.equal((await env.DB.prepare("SELECT listed FROM publications WHERE asset_id=?1").bind(fresh.id).first()).listed,0);
  assert.equal(await publishCandidate(env,project.id,fresh.id),"existing");
  assert.equal((await env.DB.prepare("SELECT listed FROM publications WHERE asset_id=?1").bind(fresh.id).first()).listed,1);
});

test("saving a new output invokes the opted-in policy without exposing its prompt", async () => {
  const { createGeneration, saveGeneration } = await import("../src/lib/jobs.mjs");
  const { PNG_1x1 } = await import("./harness.mjs");
  const { env, project } = await setup(); env.FIRST_PARTY_PUBLICATION_PROJECTS = project.id;
  await env.DB.prepare("INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)").bind(project.id).run();
  const { generation } = await createGeneration(env,project,{clientRequestId:"auto_example",kind:"image",model:"studio-draft",aspect:"square",prompt:"secret prompt",recipeId:"",controls:{}});
  const saved = await saveGeneration(env,generation,PNG_1x1,"png");
  const pub=await env.DB.prepare("SELECT * FROM publications WHERE asset_id=?1").bind(saved.output_asset_id).first();
  assert.ok(pub); assert.equal(pub.listed,1); assert.equal(pub.description,""); assert.doesNotMatch(pub.title,/secret/);
  await saveGeneration(env,generation,PNG_1x1,"png");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE asset_id=?1").bind(saved.output_asset_id).first()).n,1);
});

test("read-only project sessions cannot inspect or change publication policy", async () => {
  const {env,project}=await setup();
  const cookie="studio_session="+await createSession(env,{mode:"bridge",project:project.id,actions:["read"]});
  for (const path of ["publication-policy","publication-inventory"]) {
    const response=await worker.fetch(new Request(`https://studio.test/api/projects/${project.id}/${path}`,{headers:{cookie}}),env);
    assert.equal(response.status,403);
  }
});

test("reference-derived and incomplete provenance never auto-publishes or lists without attribution", async () => {
  const {env,project}=await setup(); env.FIRST_PARTY_PUBLICATION_PROJECTS=project.id;
  await env.DB.prepare("INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)").bind(project.id).run();
  const reference=await addAsset(env,project,{id:"asset_source",kind:"image",source:"upload"});
  await env.DB.prepare("UPDATE assets SET caption='Woodhouse · Tabler Icons (MIT) — PRIVATE' WHERE id=?1").bind(reference.id).run();
  const linked=await generated(env,project,"linked","generated",Date.now()+1);
  const hiddenLink=await generated(env,project,"hiddenlink","generated",Date.now()+1);
  const incomplete=await generated(env,project,"incomplete","generated",Date.now()+1);
  const malformed=await generated(env,project,"malformed","generated",Date.now()+1);
  const unknown=await generated(env,project,"unknownmodel","generated",Date.now()+1);
  await env.DB.prepare("UPDATE assets SET parent_asset_id=?2 WHERE id=?1").bind(linked.id,reference.id).run();
  await env.DB.prepare("UPDATE generations SET request_json=?2 WHERE id=?1").bind("gen_hiddenlink",JSON.stringify({referenceAssetId:reference.id,parentAssetId:null,maskAssetId:null})).run();
  await env.DB.prepare("UPDATE generations SET request_json='{}' WHERE id=?1").bind("gen_incomplete").run();
  await env.DB.prepare("UPDATE generations SET request_json='not json' WHERE id=?1").bind("gen_malformed").run();
  await env.DB.prepare("UPDATE generations SET model='future-unknown-model' WHERE id=?1").bind("gen_unknownmodel").run();
  await env.DB.prepare("INSERT INTO publications(id,project_id,asset_id,slug,title,description,asset_revision,created_at) VALUES('pub_linked',?1,?2,'original-linked','Existing page','Existing credit',1,1)").bind(project.id,linked.id).run();
  for(const a of [linked,hiddenLink,incomplete,malformed,unknown]) {
    assert.equal(await publishCandidate(env,project.id,a.id,{automatic:true}),"attribution_review_required");
    assert.equal(await publishCandidate(env,project.id,a.id),"attribution_review_required");
  }
  const {inventory}=await import("../src/lib/publication-policy.mjs");
  const items=(await inventory(env,project.id)).items;
  for(const a of [linked,hiddenLink,incomplete,malformed,unknown]) assert.equal(items.find(x=>x.id===a.id).status,"attribution_review_required");
  const unchanged=await env.DB.prepare("SELECT slug,description,listed FROM publications WHERE id='pub_linked'").first();
  assert.deepEqual({...unchanged},{slug:"original-linked",description:"Existing credit",listed:0});
  assert.doesNotMatch(JSON.stringify(items),/PRIVATE|Tabler/);
});

test("verified Share reference retains a public credit and MIT licence without copying private text", async (t) => {
  const {env,project}=await setup(); env.FIRST_PARTY_PUBLICATION_PROJECTS=project.id;
  await env.DB.prepare("INSERT INTO publication_policies(project_id,enabled,enabled_at,attested_at) VALUES(?1,1,1,1)").bind(project.id).run();
  const {PNG_1x1}=await import('./harness.mjs'); const {sha256Hex}=await import('../src/lib/util.mjs');
  const hash=await sha256Hex(PNG_1x1);
  const source=await addAsset(env,project,{id:"asset_reference",kind:"image",source:"upload"});
  await env.DB.prepare("UPDATE assets SET sha256=?2,caption=?3 WHERE id=?1").bind(source.id,hash,"https://woodhouse.loftwah.com/api/v1/assets/atlas-plate-20-foilbury\nPRIVATE CAPTION").run();
  const output=await generated(env,project,"verified","generated",Date.now()+1);
  await env.DB.prepare("UPDATE assets SET parent_asset_id=?2 WHERE id=?1").bind(output.id,source.id).run();
  await env.DB.prepare("UPDATE generations SET model='h3-max-turbo',request_json=?2 WHERE id=?1").bind('gen_verified',JSON.stringify({referenceAssetId:source.id,referenceSha256:hash,maskAssetId:null,parentAssetId:null,prompt:'SECRET PROMPT'})).run();
  const record={version:1,asset:{id:'atlas-plate-20-foilbury',visibility:'public',reuse:'unconfirmed',credit:'Woodhouse · gpt-image-2.6-flare · Tabler Icons (MIT)',sourceUrl:'https://woodhouse.loftwah.com/source',original:{url:'https://woodhouse.loftwah.com/original.png'}}};
  let mismatch = false;
  t.mock.method(globalThis,'fetch',async url => String(url).endsWith('/original.png') ? new Response(mismatch ? new Uint8Array([1,2,3]) : PNG_1x1) : Response.json(record));
  const {inventory}=await import('../src/lib/publication-policy.mjs');
  const failed=await generated(env,project,"bad_hash","generated",Date.now()+1);
  await env.DB.prepare("UPDATE assets SET parent_asset_id=?2 WHERE id=?1").bind(failed.id,source.id).run();
  await env.DB.prepare("UPDATE generations SET model='h3-max-turbo',request_json=?2 WHERE id=?1").bind('gen_bad_hash',JSON.stringify({referenceAssetId:source.id,referenceSha256:hash,maskAssetId:null,parentAssetId:null})).run();
  mismatch=true;
  assert.equal(await publishCandidate(env,project.id,failed.id),'attribution_review_required');
  assert.equal(await env.DB.prepare('SELECT id FROM publications WHERE asset_id=?1').bind(failed.id).first(),null);
  mismatch=false;
  record.asset.credit="Unknown third party; no verified licence";
  assert.equal(await publishCandidate(env,project.id,failed.id),'attribution_review_required');
  record.asset.credit='Woodhouse · gpt-image-2.6-flare · Tabler Icons (MIT)';
  record.asset.original.url='https://other.example/original.png';
  assert.equal(await publishCandidate(env,project.id,failed.id),'attribution_review_required');
  record.asset.original.url='https://woodhouse.loftwah.com/original.png';
  assert.equal((await inventory(env,project.id)).items.find(x=>x.id===output.id).status,'source_verification_available');
  assert.equal(await publishCandidate(env,project.id,output.id),'created');
  const pub=await env.DB.prepare('SELECT * FROM publications WHERE asset_id=?1').bind(output.id).first();
  const credits=JSON.parse(pub.attribution_json); assert.equal(credits[0].tablerMit,true);
  assert.doesNotMatch(pub.attribution_json,/PRIVATE CAPTION|SECRET PROMPT/);
  const html=await (await worker.fetch(new Request(`https://studio.test/p/${pub.slug}`),env)).text();
  assert.match(html,/Catalogue reuse status: unconfirmed/); assert.match(html,/Tabler Icons MIT licence/); assert.match(html,/Copyright \(c\) 2020-2026 Paweł Kuna/); assert.match(html,/Permission is hereby granted/);
  assert.match(html,/https:\/\/woodhouse\.loftwah\.com\/source/); assert.doesNotMatch(html,/PRIVATE CAPTION|SECRET PROMPT/);
  await env.DB.prepare('UPDATE publications SET listed=0 WHERE id=?1').bind(pub.id).run();
  assert.equal(await publishCandidate(env,project.id,output.id,{automatic:true}),'existing');
  assert.equal((await env.DB.prepare('SELECT listed FROM publications WHERE id=?1').bind(pub.id).first()).listed,0);
  assert.equal(await publishCandidate(env,project.id,output.id),'existing');
  const relisted=await env.DB.prepare('SELECT slug,listed,attribution_json FROM publications WHERE id=?1').bind(pub.id).first();
  assert.equal(relisted.slug,pub.slug); assert.equal(relisted.listed,1); assert.equal(relisted.attribution_json,pub.attribution_json);
  await env.DB.prepare('UPDATE publications SET revoked_at=1 WHERE id=?1').bind(pub.id).run();
  assert.equal(await publishCandidate(env,project.id,output.id),'skipped');
});
