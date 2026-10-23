import assert from 'node:assert/strict';

export async function testTokolinkAccess(db,{forwardSql=null}={}) {
 const checks=[];
 const alice='11111111-1111-4111-8111-111111111111';
 const bob='22222222-2222-4222-8222-222222222222';
 const bizA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const bizB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await db.query(`INSERT INTO auth.users(id) VALUES ($1),($2)`,[alice,bob]);
 await db.query(`INSERT INTO public.businesses(id,owner_id,name,is_public) VALUES ($1,$2,'Fixture A',false),($3,$4,'Fixture B',false)`,[bizA,alice,bizB,bob]);
 await db.query(`INSERT INTO public.business_members(business_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner') ON CONFLICT DO NOTHING`,[bizA,alice,bizB,bob]);
 await db.query(`INSERT INTO public.customers(business_id,name,pin) VALUES($1,'Fixture A','11112222'),($2,'Fixture B','33334444')`,[bizA,bizB]);
 await db.query(`INSERT INTO public.preparation_jobs(business_id,code,assigned_user_id,token_hash,created_by) VALUES($1,'FIXTURE-A',$2,'fixture-hash-A',$2),($3,'FIXTURE-B',$4,'fixture-hash-B',$4)`,[bizA,alice,bizB,bob]);
 async function act(name,role,uid,sql,{deny=false,code='42501',count,value,after}={}) {
  await db.exec('BEGIN');
  try {
   await db.exec(`SET LOCAL ROLE ${role}`);
   await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`,[uid??'']);
   let r;
   try {r=await db.query(sql);}
   catch(err){if(!deny||err.code!==code)throw err;checks.push({name,result:'pass',sqlstate:err.code});return;}
   if(deny)throw new Error(`${name}: expected SQLSTATE 42501`);
   if(count!==undefined)assert.equal((/^\s*SELECT/i.test(sql)?r.rows.length:r.affectedRows),count,name);
   if(value!==undefined)assert.equal(Object.values(r.rows[0])[0],value,name);
   if(after)await after(r);
   checks.push({name,result:'pass',affectedRows:r.affectedRows,rows:r.rows.length});
  }finally{await db.exec('ROLLBACK');}
 }
 await act('authenticated owner can read own settings','authenticated',alice,`SELECT user_id FROM user_settings`,{count:1});
 await act('authenticated cannot read another user settings','authenticated',alice,`SELECT user_id FROM user_settings WHERE user_id='${bob}'`,{count:0});
 await act('authenticated owner updates own settings','authenticated',alice,`UPDATE user_settings SET theme='light' WHERE user_id='${alice}' RETURNING user_id`,{count:1});
 await act('authenticated cannot update another user settings','authenticated',alice,`UPDATE user_settings SET theme='light' WHERE user_id='${bob}'`,{count:0});
 await act('anonymous settings SELECT denied','anon',null,`SELECT user_id FROM user_settings`,{deny:true});
 await act('customer safe SELECT returns only same tenant','authenticated',alice,`SELECT name FROM customers`,{count:1,value:'Fixture A'});
 await act('customer safe SELECT hides other tenant','authenticated',alice,`SELECT id FROM customers WHERE business_id='${bizB}'`,{count:0});
 await act('customer PIN SELECT denied','authenticated',alice,`SELECT pin FROM customers`,{deny:true});
 await act('customer wildcard SELECT denied','authenticated',alice,`SELECT * FROM customers`,{deny:true});
 await act('anonymous customer safe SELECT denied','anon',null,`SELECT id FROM customers`,{deny:true});
 await act('preparation safe SELECT returns only own tenant job','authenticated',alice,`SELECT code FROM preparation_jobs`,{count:1,value:'FIXTURE-A'});
 await act('preparation sensitive delivered_pin SELECT denied','authenticated',alice,`SELECT delivered_pin FROM preparation_jobs`,{deny:true});
 await act('anonymous preparation reads zero rows despite legacy column ACL','anon',null,`SELECT id,token_hash FROM preparation_jobs`,{count:0});
 await act('anonymous preparation delivered_pin SELECT denied','anon',null,`SELECT delivered_pin FROM preparation_jobs`,{deny:true});
 for(const table of ['profiles','devices','background_action_log','device_action_rate','pin_search_log']) {
  await act(`authenticated direct ${table} SELECT denied`,'authenticated',alice,`SELECT * FROM ${table}`,{deny:true});
  await act(`anon direct ${table} SELECT denied`,'anon',null,`SELECT * FROM ${table}`,{deny:true});
 }
 await act('authenticated cannot consume server-owned PIN sequence','authenticated',alice,`SELECT nextval('public.pin_search_log_id_seq')`,{deny:true});
 await act('anonymous cannot consume PIN sequence','anon',null,`SELECT nextval('public.pin_search_log_id_seq')`,{deny:true});
 await act('service_role can consume PIN sequence','service_role',null,`SELECT nextval('public.pin_search_log_id_seq')`,{count:1});
 await act('service_role can read customer PIN through explicit privilege','service_role',null,`SELECT pin FROM public.customers`,{count:2});
 await act('service_role bypasses user-settings RLS with explicit table privilege','service_role',null,`SELECT user_id FROM user_settings`,{count:2});
 await act('inventory balances authenticated INSERT remains denied','authenticated',alice,`INSERT INTO inventory_balances DEFAULT VALUES`,{deny:true});
 await act('inventory balances authenticated UPDATE remains denied','authenticated',alice,`UPDATE inventory_balances SET qty_base=qty_base`,{deny:true});
 await act('call log hides authenticated UPDATE remains denied','authenticated',alice,`UPDATE call_log_hides SET created_at=created_at`,{deny:true});
 await act('status views authenticated UPDATE remains denied','authenticated',alice,`UPDATE status_views SET viewer_id=viewer_id`,{deny:true});
 if(forwardSql) {
  const productA='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const productB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const viewer='33333333-3333-4333-8333-333333333333';
  await db.query(`INSERT INTO auth.users(id) VALUES($1)`,[viewer]);
  await db.query(`INSERT INTO public.business_members(business_id,user_id,role) VALUES($1,$2,'viewer')`,[bizA,viewer]);
  await db.query(`INSERT INTO public.products(id,business_id,name) VALUES($1,$2,'Fixture product A'),($3,$4,'Fixture product B')`,[productA,bizA,productB,bizB]);
  const variantInsert=`INSERT INTO product_variants(business_id,product_id,name,units_per_display) VALUES('${bizA}','${productA}','Fixture variant',1) RETURNING id`;
  await act('business owner creates variant and gets zero inventory balance atomically','authenticated',alice,variantInsert,{count:1,after:async r=>{
   const balances=await db.query('SELECT qty_base,business_id,product_id FROM inventory_balances WHERE variant_id=$1',[r.rows[0].id]);
   assert.equal(balances.rows.length,1);assert.equal(Number(balances.rows[0].qty_base),0);
   assert.equal(balances.rows[0].business_id,bizA);assert.equal(balances.rows[0].product_id,productA);
  }});
  await act('other tenant cannot create variant','authenticated',bob,variantInsert,{deny:true});
  await act('viewer cannot create variant','authenticated',viewer,variantInsert,{deny:true});
  await act('anonymous cannot create variant','anon',null,variantInsert,{deny:true});
  await act('variant rejects product from another business before privileged initialization','authenticated',alice,
   `INSERT INTO product_variants(business_id,product_id,name,units_per_display) VALUES('${bizA}','${productB}','Invalid parent',1)`,{deny:true,code:'23514'});
  const variants=await db.query(`INSERT INTO public.product_variants(business_id,product_id,name,units_per_display) VALUES($1,$2,'Existing nonzero',1),($1,$2,'Missing balance',1) RETURNING id`,[bizA,productA]);
  const nonzero=variants.rows[0].id,missing=variants.rows[1].id;
  await db.query('UPDATE public.inventory_balances SET qty_base=7 WHERE variant_id=$1',[nonzero]);
  await db.query('DELETE FROM public.inventory_balances WHERE variant_id=$1',[missing]);
  await db.exec(forwardSql);await db.exec(forwardSql);
  const balanceRows=await db.query('SELECT variant_id,qty_base FROM public.inventory_balances WHERE variant_id IN ($1,$2) ORDER BY variant_id',[nonzero,missing]);
  assert.equal(balanceRows.rows.length,1);
  assert.equal(Number(balanceRows.rows.find(x=>x.variant_id===nonzero).qty_base),7);
  assert.equal(balanceRows.rows.find(x=>x.variant_id===missing),undefined);
  checks.push({name:'forward migration is idempotent and preserves existing nonzero stock7 without backfilling old rows',result:'pass'});
  const call=(await db.query(`INSERT INTO calls(initiator_id) VALUES($1) RETURNING id`,[alice])).rows[0].id;
  const status=(await db.query(`INSERT INTO statuses(owner_id,expires_at) VALUES($1,now()+interval '1 day') RETURNING id`,[alice])).rows[0].id;
  const item=(await db.query(`INSERT INTO status_items(status_id,owner_id,kind) VALUES($1,$2,'text') RETURNING id`,[status,alice])).rows[0].id;
  const hideInsert=`INSERT INTO call_log_hides(user_id,call_id) VALUES('${alice}','${call}') ON CONFLICT(user_id,call_id) DO NOTHING`;
  const viewInsert=`INSERT INTO status_views(viewer_id,status_id,item_id) VALUES('${alice}','${status}','${item}') ON CONFLICT(item_id,viewer_id) DO NOTHING`;
  const muteInsert=`INSERT INTO status_mutes(user_id,muted_user_id) VALUES('${alice}','${bob}') ON CONFLICT(user_id,muted_user_id) DO NOTHING`;
  await act('call hide insert ignoring duplicates is idempotent without UPDATE grant','authenticated',alice,hideInsert,{count:1,after:async()=>assert.equal((await db.query(hideInsert)).affectedRows,0)});
  await act('status view insert ignoring duplicates is idempotent without UPDATE grant','authenticated',alice,viewInsert,{count:1,after:async()=>assert.equal((await db.query(viewInsert)).affectedRows,0)});
  await act('status mute insert ignoring duplicates is idempotent without UPDATE grant','authenticated',alice,muteInsert,{count:1,after:async()=>assert.equal((await db.query(muteInsert)).affectedRows,0)});
  await act('status mutes authenticated UPDATE remains denied','authenticated',alice,`UPDATE status_mutes SET created_at=created_at`,{deny:true});
  await act('call hide cannot be forged for another user','authenticated',bob,hideInsert,{deny:true});
  await act('status view cannot be forged for another user','authenticated',bob,viewInsert,{deny:true});
  await act('status mute cannot be forged for another user','authenticated',bob,muteInsert,{deny:true});
 }
 return checks;
}
